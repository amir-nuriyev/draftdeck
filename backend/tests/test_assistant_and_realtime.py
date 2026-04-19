from __future__ import annotations

import json
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import DraftCollaborator, Member
from app.prompts import build_prompt
from app.schemas import AssistantSuggestRequest
from app.security import hash_password
from app.services import build_lm_studio_chat_url, sanitize_model_output


TEST_DATABASE_URL = "sqlite://"

test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(
    bind=test_engine,
    autoflush=False,
    autocommit=False,
)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def seed_demo_members() -> None:
    with TestingSessionLocal() as db:
        db.add_all(
            [
                Member(
                    email="maya@draftdeck.local",
                    username="maya",
                    display_name="Maya Stone",
                    password_hash=hash_password("owner123"),
                    focus_area="Product lead",
                    color_hex="#d97706",
                ),
                Member(
                    email="omar@draftdeck.local",
                    username="omar",
                    display_name="Omar Vale",
                    password_hash=hash_password("editor123"),
                    focus_area="Research editor",
                    color_hex="#0f766e",
                ),
                Member(
                    email="nika@draftdeck.local",
                    username="nika",
                    display_name="Nika Ross",
                    password_hash=hash_password("viewer123"),
                    focus_area="Read-only reviewer",
                    color_hex="#334155",
                ),
            ]
        )
        db.commit()


@pytest.fixture(autouse=True)
def reset_db():
    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)
    seed_demo_members()
    app.dependency_overrides[get_db] = override_get_db
    app.state.session_factory = TestingSessionLocal
    yield
    app.dependency_overrides.clear()
    if hasattr(app.state, "session_factory"):
        delattr(app.state, "session_factory")
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def login_headers(client: TestClient, *, login: str = "maya", password: str = "owner123") -> dict[str, str]:
    response = client.post("/api/auth/login", json={"login": login, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def login_token(client: TestClient, *, login: str = "maya", password: str = "owner123") -> str:
    response = client.post("/api/auth/login", json={"login": login, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


def create_shared_draft(client: TestClient) -> int:
    response = client.post(
        "/api/drafts",
        json={
            "title": "Research sprint",
            "brief": "Short collaboration brief",
            "content": "<p>Initial body</p>",
            "stage": "drafting",
            "accent": "ember",
            "create_snapshot": True,
        },
        headers=login_headers(client),
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_assistant_suggest_returns_mock_metadata(client: TestClient):
    with patch("app.config.settings.llm_mock", True):
        response = client.post(
            "/api/assistant/suggest",
            json={
                "feature": "summarize",
                "selected_text": "A long paragraph that should be summarized by the mock assistant.",
            },
            headers=login_headers(client),
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "mock"
    assert payload["mocked"] is True
    assert payload["model_name"] == "mock-summarize"
    assert payload["decision"] == "pending"


def test_assistant_stream_and_cancel(client: TestClient):
    draft_id = create_shared_draft(client)
    headers = login_headers(client)

    with patch("app.config.settings.llm_mock", True):
        with client.stream(
            "POST",
            "/api/assistant/suggest/stream",
            headers=headers,
            json={
                "feature": "rewrite",
                "selected_text": "This sentence should stream token by token for cancellation coverage.",
                "draft_id": draft_id,
            },
        ) as stream_response:
            assert stream_response.status_code == 200
            current_event = ""
            run_id = None
            canceled_seen = False
            for raw_line in stream_response.iter_lines():
                line = raw_line.strip()
                if not line:
                    continue
                if line.startswith("event:"):
                    current_event = line.replace("event:", "").strip()
                    continue
                if not line.startswith("data:"):
                    continue
                payload = json.loads(line.replace("data:", "").strip())
                if current_event == "start":
                    run_id = int(payload["run_id"])
                    cancel = client.post(f"/api/assistant/runs/{run_id}/cancel", headers=headers)
                    assert cancel.status_code == 200
                if current_event == "canceled":
                    canceled_seen = True
                    break
            assert run_id is not None

    run = None
    for _ in range(20):
        history = client.get(f"/api/assistant/runs?draft_id={draft_id}&limit=5", headers=headers)
        assert history.status_code == 200
        run = next(item for item in history.json() if item["id"] == run_id)
        if run["status"] != "streaming":
            break
        time.sleep(0.05)
    assert run is not None
    assert run["status"] in {"streaming", "canceled", "completed"}
    if canceled_seen and run["status"] == "canceled":
        assert run["decision"] == "canceled"


def test_assistant_history_filters_and_decision_updates(client: TestClient):
    draft_id = create_shared_draft(client)
    headers = login_headers(client)
    with patch("app.config.settings.llm_mock", True):
        run = client.post(
            "/api/assistant/suggest",
            json={
                "feature": "summarize",
                "selected_text": "First chunk",
                "draft_id": draft_id,
            },
            headers=headers,
        )
    assert run.status_code == 200
    run_id = run.json()["run_id"]

    filtered = client.get(f"/api/assistant/runs?draft_id={draft_id}&feature=summarize", headers=headers)
    assert filtered.status_code == 200
    assert len(filtered.json()) == 1

    updated = client.patch(
        f"/api/assistant/runs/{run_id}",
        json={"decision": "accepted", "applied_excerpt": "Inserted into draft"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["decision"] == "accepted"


def test_websocket_presence_and_patch_events(client: TestClient):
    draft_id = create_shared_draft(client)
    with TestingSessionLocal() as db:
        db.add(DraftCollaborator(draft_id=draft_id, member_id=2, role="editor"))
        db.commit()

    token_owner = login_token(client, login="maya", password="owner123")
    token_editor = login_token(client, login="omar", password="editor123")

    with client.websocket_connect(f"/ws/drafts/{draft_id}?token={token_owner}&clientId=c1") as ws1:
        ack1 = ws1.receive_json()
        bootstrap1 = ws1.receive_json()
        sync1 = ws1.receive_json()
        assert ack1["type"] == "session:ack"
        assert bootstrap1["type"] == "yjs:bootstrap"
        assert sync1["type"] == "presence:sync"

        with client.websocket_connect(f"/ws/drafts/{draft_id}?token={token_editor}&clientId=c2") as ws2:
            ws2.receive_json()
            ws2.receive_json()
            ws2.receive_json()
            ws1.receive_json()

            ws2.send_json({"type": "draft:patch", "payload": {"content": "<p>remote change</p>"}})
            patch = ws1.receive_json()
            assert patch["type"] == "draft:patch"
            assert patch["payload"]["content"] == "<p>remote change</p>"


def test_websocket_bootstrap_replays_yjs_updates(client: TestClient):
    draft_id = create_shared_draft(client)
    with TestingSessionLocal() as db:
        db.add(DraftCollaborator(draft_id=draft_id, member_id=2, role="editor"))
        db.commit()

    token_owner = login_token(client, login="maya", password="owner123")
    token_editor = login_token(client, login="omar", password="editor123")

    with client.websocket_connect(f"/ws/drafts/{draft_id}?token={token_owner}&clientId=c1") as ws1:
        ws1.receive_json()  # session:ack
        ws1.receive_json()  # yjs:bootstrap
        ws1.receive_json()  # presence:sync
        ws1.send_json({"type": "yjs:update", "payload": {"update": "AQID"}})

        # sender does not get its own yjs:update back
        with client.websocket_connect(f"/ws/drafts/{draft_id}?token={token_editor}&clientId=c2") as ws2:
            ws2.receive_json()  # session:ack
            bootstrap = ws2.receive_json()
            assert bootstrap["type"] == "yjs:bootstrap"
            assert bootstrap["updates"] == [{"update": "AQID"}]


def test_websocket_blocks_viewer_from_mutation_messages(client: TestClient):
    draft_id = create_shared_draft(client)
    with TestingSessionLocal() as db:
        db.add(DraftCollaborator(draft_id=draft_id, member_id=3, role="viewer"))
        db.commit()

    token_viewer = login_token(client, login="nika", password="viewer123")
    with client.websocket_connect(f"/ws/drafts/{draft_id}?token={token_viewer}&clientId=cv") as ws:
        ws.receive_json()  # session:ack
        ws.receive_json()  # yjs:bootstrap
        ws.receive_json()  # presence:sync
        ws.send_json({"type": "draft:patch", "payload": {"content": "blocked"}})
        error = ws.receive_json()
        assert error["type"] == "error"
        assert "does not allow" in error["message"]


def test_prompt_builder_truncates_long_context():
    prompt = build_prompt(
        AssistantSuggestRequest(
            feature="summarize",
            selected_text="x" * 3800,
            surrounding_context="y" * 3000,
        )
    )
    assert "[context: truncated" in prompt
    assert "[selection: truncated" in prompt


def test_lm_studio_helpers_normalize_urls_and_strip_wrappers():
    with patch("app.config.settings.lm_studio_base_url", "http://127.0.0.1:1234"):
        assert build_lm_studio_chat_url() == "http://127.0.0.1:1234/v1/chat/completions"

    with patch("app.config.settings.lm_studio_base_url", "http://127.0.0.1:1234/v1"):
        assert build_lm_studio_chat_url() == "http://127.0.0.1:1234/v1/chat/completions"

    assert sanitize_model_output("Here is your rewritten text: Cleaner sentence.") == "Cleaner sentence."
    assert sanitize_model_output("```text\nTranslated paragraph.\n```") == "Translated paragraph."

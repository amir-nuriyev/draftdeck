from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import DraftCollaborator, Member
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


def auth_headers(user_id: int = 1) -> dict[str, str]:
    return {"X-User-Id": str(user_id)}


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
                    display_name="Maya Stone",
                    focus_area="Product lead",
                    color_hex="#d97706",
                ),
                Member(
                    email="omar@draftdeck.local",
                    display_name="Omar Vale",
                    focus_area="Research editor",
                    color_hex="#0f766e",
                ),
                Member(
                    email="irene@draftdeck.local",
                    display_name="Irene Park",
                    focus_area="Content reviewer",
                    color_hex="#2563eb",
                ),
                Member(
                    email="nika@draftdeck.local",
                    display_name="Nika Ross",
                    focus_area="Read-only stakeholder",
                    color_hex="#7c3aed",
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
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def create_shared_draft(client: TestClient) -> int:
    response = client.post(
        "/api/drafts",
        json={
            "title": "Research sprint",
            "brief": "Short collaboration brief",
            "content": "Initial body",
            "stage": "drafting",
            "accent": "ember",
            "create_snapshot": True,
        },
        headers=auth_headers(1),
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_assistant_suggest_returns_mock_metadata(client: TestClient):
    with patch("app.services.settings.llm_mock", True):
        response = client.post(
            "/api/assistant/suggest",
            json={
                "feature": "summarize",
                "selected_text": "A long paragraph that should be summarized by the mock assistant.",
            },
            headers=auth_headers(1),
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "mock"
    assert payload["mocked"] is True
    assert payload["model_name"] == "mock-summarize"
    assert payload["decision"] == "pending"


def test_assistant_history_filters_and_decision_updates(client: TestClient):
    first_draft_id = create_shared_draft(client)
    second_response = client.post(
        "/api/drafts",
        json={
            "title": "Outline pass",
            "brief": "Another draft",
            "content": "Second body",
            "stage": "concept",
            "accent": "tidal",
            "create_snapshot": False,
        },
        headers=auth_headers(1),
    )
    second_draft_id = second_response.json()["id"]

    with patch("app.services.settings.llm_mock", True):
        first_run = client.post(
            "/api/assistant/suggest",
            json={
                "feature": "summarize",
                "selected_text": "First chunk",
                "draft_id": first_draft_id,
            },
            headers=auth_headers(1),
        ).json()
        client.post(
            "/api/assistant/suggest",
            json={
                "feature": "rewrite",
                "selected_text": "Second chunk",
                "draft_id": second_draft_id,
            },
            headers=auth_headers(1),
        )

    filtered = client.get(
        f"/api/assistant/runs?draft_id={first_draft_id}&feature=summarize",
        headers=auth_headers(1),
    )
    assert filtered.status_code == 200
    payload = filtered.json()
    assert len(payload) == 1
    assert payload[0]["draft_id"] == first_draft_id
    assert payload[0]["feature"] == "summarize"

    updated = client.patch(
        f"/api/assistant/runs/{first_run['run_id']}",
        json={"decision": "accepted", "applied_excerpt": "Inserted into draft"},
        headers=auth_headers(1),
    )
    assert updated.status_code == 200
    assert updated.json()["decision"] == "accepted"
    assert updated.json()["applied_excerpt"] == "Inserted into draft"


def test_commenter_cannot_invoke_assistant_for_a_shared_draft(client: TestClient):
    draft_id = create_shared_draft(client)
    with TestingSessionLocal() as db:
        db.add(DraftCollaborator(draft_id=draft_id, member_id=3, role="commenter"))
        db.commit()

    with patch("app.services.settings.llm_mock", True):
        response = client.post(
            "/api/assistant/suggest",
            json={
                "feature": "rewrite",
                "selected_text": "Need a rewrite",
                "draft_id": draft_id,
            },
            headers=auth_headers(3),
        )

    assert response.status_code == 403


def test_websocket_presence_and_draft_events(client: TestClient):
    with client.websocket_connect("/ws/drafts/alpha?userId=1&userName=Maya&clientId=c1") as ws1:
        ack1 = ws1.receive_json()
        sync1 = ws1.receive_json()

        assert ack1["type"] == "session:ack"
        assert sync1["type"] == "presence:sync"
        assert len(sync1["participants"]) == 1

        with client.websocket_connect("/ws/drafts/alpha?userId=2&userName=Omar&clientId=c2") as ws2:
            ws2.receive_json()
            ws2.receive_json()
            ws1.receive_json()

            ws2.send_json(
                {
                    "type": "presence:update",
                    "cursor": {"from": 4},
                    "selection": {"from": 4, "to": 8},
                }
            )
            ws2_presence = ws2.receive_json()
            ws1_presence = ws1.receive_json()

            assert ws2_presence["type"] == "presence:sync"
            assert ws1_presence["participants"][1]["selection"] == {"from": 4, "to": 8}

            ws2.send_json({"type": "draft:patch", "payload": {"content": "remote change"}})
            draft_patch = ws1.receive_json()
            assert draft_patch["type"] == "draft:patch"
            assert draft_patch["sender"]["memberName"] == "Omar"
            assert draft_patch["payload"] == {"content": "remote change"}

            ws2.send_json({"type": "assistant:status", "payload": {"feature": "summarize"}})
            assistant_event = ws1.receive_json()
            assert assistant_event["type"] == "assistant:status"
            assert assistant_event["payload"]["feature"] == "summarize"


def test_websocket_warns_on_overlapping_edits(client: TestClient):
    with client.websocket_connect("/ws/drafts/conflict-room?userId=1&userName=Maya&clientId=c1") as ws1:
        ws1.receive_json()
        ws1.receive_json()

        with client.websocket_connect("/ws/drafts/conflict-room?userId=2&userName=Omar&clientId=c2") as ws2:
            ws2.receive_json()
            ws2.receive_json()
            ws1.receive_json()

            ws1.send_json(
                {
                    "type": "presence:update",
                    "cursor": {"from": 6, "to": 6},
                    "selection": {"from": 6, "to": 12},
                }
            )
            ws1.receive_json()
            ws2.receive_json()

            ws2.send_json(
                {
                    "type": "presence:update",
                    "cursor": {"from": 8, "to": 8},
                    "selection": {"from": 8, "to": 14},
                }
            )
            ws2.receive_json()
            ws1.receive_json()

            ws2.send_json(
                {
                    "type": "draft:patch",
                    "payload": {
                        "content": "overlapping change",
                        "range": {"from": 8, "to": 10},
                    },
                }
            )

            warning_for_sender = ws2.receive_json()
            warning_for_other = ws1.receive_json()
            patch_for_other = ws1.receive_json()

            assert warning_for_sender["type"] == "conflict:warning"
            assert warning_for_other["type"] == "conflict:warning"
            assert {participant["memberName"] for participant in warning_for_sender["participants"]} == {
                "Maya",
                "Omar",
            }
            assert patch_for_other["type"] == "draft:patch"
            assert patch_for_other["payload"]["content"] == "overlapping change"


def test_lm_studio_helpers_normalize_urls_and_strip_wrappers():
    with patch("app.services.settings.lm_studio_base_url", "http://127.0.0.1:1234"):
        assert build_lm_studio_chat_url() == "http://127.0.0.1:1234/v1/chat/completions"

    with patch("app.services.settings.lm_studio_base_url", "http://127.0.0.1:1234/v1"):
        assert build_lm_studio_chat_url() == "http://127.0.0.1:1234/v1/chat/completions"

    assert sanitize_model_output("Here is your rewritten text: Cleaner sentence.") == "Cleaner sentence."
    assert sanitize_model_output("```text\nTranslated paragraph.\n```") == "Translated paragraph."

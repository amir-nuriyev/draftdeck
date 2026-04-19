from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import DraftCollaborator, Member
from app.security import hash_password


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
                    email="irene@draftdeck.local",
                    username="irene",
                    display_name="Irene Park",
                    password_hash=hash_password("comment123"),
                    focus_area="Content reviewer",
                    color_hex="#2563eb",
                ),
                Member(
                    email="nika@draftdeck.local",
                    username="nika",
                    display_name="Nika Ross",
                    password_hash=hash_password("viewer123"),
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
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def create_draft(client: TestClient, *, stage: str = "concept") -> dict:
    response = client.post(
        "/api/drafts",
        json={
            "title": "Market brief",
            "brief": "Launch planning note",
            "content": "<p>Original content</p>",
            "stage": stage,
            "accent": "ember",
            "create_snapshot": True,
        },
        headers=login_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def test_register_login_and_refresh_flow(client: TestClient):
    register = client.post(
        "/api/auth/register",
        json={
            "email": "new@draftdeck.local",
            "username": "newuser",
            "display_name": "New User",
            "password": "newpassword123",
        },
    )
    assert register.status_code == 201
    assert "access_token" in register.json()

    login = client.post("/api/auth/login", json={"login": "newuser", "password": "newpassword123"})
    assert login.status_code == 200
    refresh_token = login.json()["refresh_token"]
    refreshed = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert refreshed.status_code == 200
    assert refreshed.json()["access_token"] != login.json()["access_token"]


def test_create_draft_and_list_snapshots(client: TestClient):
    created = create_draft(client)
    snapshots = client.get(
        f"/api/drafts/{created['id']}/snapshots",
        headers=login_headers(client),
    )
    assert snapshots.status_code == 200
    assert len(snapshots.json()) == 1
    assert snapshots.json()[0]["label"] == "Kickoff snapshot"
    assert created["plain_content"] == "Original content"


def test_editor_can_update_but_viewer_cannot(client: TestClient):
    created = create_draft(client)
    draft_id = created["id"]

    with TestingSessionLocal() as db:
        db.add(DraftCollaborator(draft_id=draft_id, member_id=2, role="editor"))
        db.add(DraftCollaborator(draft_id=draft_id, member_id=4, role="viewer"))
        db.commit()

    editor_update = client.patch(
        f"/api/drafts/{draft_id}",
        json={"content": "<p>Edited by Omar</p>", "stage": "review"},
        headers=login_headers(client, login="omar", password="editor123"),
    )
    assert editor_update.status_code == 200
    assert editor_update.json()["stage"] == "review"

    viewer_update = client.patch(
        f"/api/drafts/{draft_id}",
        json={"content": "<p>Viewer edit</p>"},
        headers=login_headers(client, login="nika", password="viewer123"),
    )
    assert viewer_update.status_code == 403


def test_share_link_create_resolve_and_revoke(client: TestClient):
    created = create_draft(client)
    draft_id = created["id"]
    owner_headers = login_headers(client)

    link = client.post(
        f"/api/drafts/{draft_id}/share-links",
        json={"role": "viewer", "access_mode": "public"},
        headers=owner_headers,
    )
    assert link.status_code == 201
    token = link.json()["token"]

    resolved = client.get(f"/api/share/{token}/resolve")
    assert resolved.status_code == 200
    assert resolved.json()["granted_role"] == "viewer"

    revoked = client.delete(
        f"/api/drafts/{draft_id}/share-links/{link.json()['id']}",
        headers=owner_headers,
    )
    assert revoked.status_code == 204

    after_revoke = client.get(f"/api/share/{token}/resolve")
    assert after_revoke.status_code == 410


def test_authenticated_share_link_requires_login(client: TestClient):
    created = create_draft(client)
    draft_id = created["id"]
    owner_headers = login_headers(client)

    link = client.post(
        f"/api/drafts/{draft_id}/share-links",
        json={"role": "editor", "access_mode": "authenticated"},
        headers=owner_headers,
    )
    assert link.status_code == 201
    token = link.json()["token"]

    unauthenticated = client.get(f"/api/share/{token}/resolve")
    assert unauthenticated.status_code == 401

    viewer_headers = login_headers(client, login="nika", password="viewer123")
    authenticated = client.get(f"/api/share/{token}/resolve", headers=viewer_headers)
    assert authenticated.status_code == 200
    assert authenticated.json()["granted_role"] == "editor"


def test_session_endpoint_reports_capabilities(client: TestClient):
    created = create_draft(client)
    draft_id = created["id"]

    with TestingSessionLocal() as db:
        db.add(DraftCollaborator(draft_id=draft_id, member_id=2, role="editor"))
        db.commit()

    response = client.get(
        f"/api/session?draft_id={draft_id}",
        headers=login_headers(client, login="omar", password="editor123"),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["auth_mode"] == "jwt"
    assert payload["member"]["username"] == "omar"
    assert payload["draft_role"] == "editor"
    assert payload["capabilities"]["can_edit_draft"] is True
    assert payload["capabilities"]["can_manage_collaborators"] is False

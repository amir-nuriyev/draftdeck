import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import DraftCollaborator, Member


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


def auth_headers(user_id: int) -> dict[str, str]:
    return {"X-User-Id": str(user_id)}


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


def create_draft(client: TestClient, *, stage: str = "concept") -> dict:
    response = client.post(
        "/api/drafts",
        json={
            "title": "Market brief",
            "brief": "Launch planning note",
            "content": "Original content",
            "stage": stage,
            "accent": "ember",
            "create_snapshot": True,
        },
        headers=auth_headers(1),
    )
    assert response.status_code == 201
    return response.json()


def test_create_draft_and_list_snapshots(client: TestClient):
    created = create_draft(client)
    snapshots = client.get(
        f"/api/drafts/{created['id']}/snapshots",
        headers=auth_headers(1),
    )
    assert snapshots.status_code == 200
    assert len(snapshots.json()) == 1
    assert snapshots.json()[0]["label"] == "Kickoff snapshot"


def test_editor_can_update_but_viewer_cannot(client: TestClient):
    created = create_draft(client)
    draft_id = created["id"]

    with TestingSessionLocal() as db:
        db.add(DraftCollaborator(draft_id=draft_id, member_id=2, role="editor"))
        db.add(DraftCollaborator(draft_id=draft_id, member_id=4, role="viewer"))
        db.commit()

    editor_update = client.patch(
        f"/api/drafts/{draft_id}",
        json={"content": "Edited by Omar", "stage": "review"},
        headers=auth_headers(2),
    )
    assert editor_update.status_code == 200
    assert editor_update.json()["stage"] == "review"

    viewer_update = client.patch(
        f"/api/drafts/{draft_id}",
        json={"content": "Viewer edit"},
        headers=auth_headers(4),
    )
    assert viewer_update.status_code == 403


def test_non_collaborator_cannot_read_unshared_draft(client: TestClient):
    created = create_draft(client)
    draft_id = created["id"]

    response = client.get(
        f"/api/drafts/{draft_id}",
        headers=auth_headers(4),
    )
    assert response.status_code == 403


def test_owner_can_manage_collaborators_and_export(client: TestClient):
    created = create_draft(client)
    draft_id = created["id"]

    grant = client.post(
        f"/api/drafts/{draft_id}/collaborators",
        json={"member_id": 2, "role": "editor"},
        headers=auth_headers(1),
    )
    assert grant.status_code == 201
    assert grant.json()["display_name"] == "Omar Vale"

    collaborators = client.get(
        f"/api/drafts/{draft_id}/collaborators",
        headers=auth_headers(1),
    )
    assert collaborators.status_code == 200
    assert len(collaborators.json()) == 1

    markdown_export = client.get(
        f"/api/drafts/{draft_id}/export?format=md",
        headers=auth_headers(1),
    )
    assert markdown_export.status_code == 200
    assert markdown_export.text == "# Market brief\n\nOriginal content"
    assert "market-brief.md" in markdown_export.headers["content-disposition"]

    removed = client.delete(
        f"/api/drafts/{draft_id}/collaborators/2",
        headers=auth_headers(1),
    )
    assert removed.status_code == 204


def test_overview_reports_accessible_stage_counts(client: TestClient):
    create_draft(client, stage="concept")
    client.post(
        "/api/drafts",
        json={
            "title": "Review memo",
            "brief": "Needs review",
            "content": "Ready for review",
            "stage": "review",
            "accent": "lagoon",
            "create_snapshot": False,
        },
        headers=auth_headers(1),
    )

    overview = client.get("/api/studio/overview", headers=auth_headers(1))
    assert overview.status_code == 200
    payload = overview.json()
    assert payload["accessible_drafts"] == 2
    assert payload["concept_count"] == 1
    assert payload["review_count"] == 1
    assert payload["active_members"] == 4


def test_session_endpoint_reports_capabilities_for_shared_editor(client: TestClient):
    created = create_draft(client)
    draft_id = created["id"]

    with TestingSessionLocal() as db:
        db.add(DraftCollaborator(draft_id=draft_id, member_id=2, role="editor"))
        db.commit()

    response = client.get(
        f"/api/session?draft_id={draft_id}",
        headers=auth_headers(2),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["auth_mode"] == "demo-header"
    assert payload["member"]["display_name"] == "Omar Vale"
    assert payload["draft_role"] == "editor"
    assert payload["capabilities"]["can_edit_draft"] is True
    assert payload["capabilities"]["can_manage_collaborators"] is False


def test_invalid_user_header_is_rejected(client: TestClient):
    response = client.get("/api/session", headers=auth_headers(999))
    assert response.status_code == 401


def test_restore_snapshot_returns_old_content(client: TestClient):
    created = create_draft(client)
    draft_id = created["id"]

    client.patch(
        f"/api/drafts/{draft_id}",
        json={
            "content": "Changed body",
            "create_snapshot": True,
            "snapshot_label": "Changed version",
        },
        headers=auth_headers(1),
    )

    snapshots = client.get(
        f"/api/drafts/{draft_id}/snapshots",
        headers=auth_headers(1),
    )
    original_snapshot = snapshots.json()[-1]

    restored = client.post(
        f"/api/drafts/{draft_id}/snapshots/{original_snapshot['id']}/restore",
        headers=auth_headers(1),
    )
    assert restored.status_code == 200
    assert restored.json()["content"] == "Original content"

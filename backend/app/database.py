from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


def _sqlite_connect_args(database_url: str) -> dict[str, bool]:
    return {"check_same_thread": False} if database_url.startswith("sqlite") else {}


def ensure_database_directory(database_url: str) -> None:
    if not database_url.startswith("sqlite:///"):
        return

    relative_path = database_url.removeprefix("sqlite:///")
    db_path = Path(relative_path)
    if not db_path.is_absolute():
        db_path = Path.cwd() / db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)


ensure_database_directory(settings.database_url)

engine = create_engine(
    settings.database_url,
    connect_args=_sqlite_connect_args(settings.database_url),
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def ensure_local_schema() -> None:
    import app.models  # noqa: F401

    if not settings.database_url.startswith("sqlite"):
        Base.metadata.create_all(bind=engine)
        return

    inspector = inspect(engine)
    expected_tables = {
        "members",
        "refresh_sessions",
        "drafts",
        "draft_versions",
        "draft_collaborators",
        "draft_snapshots",
        "share_links",
        "assistant_runs",
    }
    actual_tables = set(inspector.get_table_names())

    schema_is_current = expected_tables.issubset(actual_tables)
    if schema_is_current and inspector.has_table("members") and inspector.has_table("assistant_runs"):
        members_columns = {column["name"] for column in inspector.get_columns("members")}
        run_columns = {column["name"] for column in inspector.get_columns("assistant_runs")}
        schema_is_current = (
            "username" in members_columns
            and "password_hash" in members_columns
            and "provider" in run_columns
            and "prompt_text" in run_columns
        )

    if schema_is_current:
        Base.metadata.create_all(bind=engine)
        return

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def seed_demo_users() -> None:
    from app.models import Member
    from app.security import hash_password

    demo_members = [
        {
            "email": "maya@draftdeck.local",
            "username": "maya",
            "display_name": "Maya Stone",
            "password": "owner123",
            "focus_area": "Product lead",
            "color_hex": "#d97706",
        },
        {
            "email": "omar@draftdeck.local",
            "username": "omar",
            "display_name": "Omar Vale",
            "password": "editor123",
            "focus_area": "Research editor",
            "color_hex": "#0f766e",
        },
        {
            "email": "irene@draftdeck.local",
            "username": "irene",
            "display_name": "Irene Park",
            "password": "comment123",
            "focus_area": "Content reviewer",
            "color_hex": "#2563eb",
        },
        {
            "email": "nika@draftdeck.local",
            "username": "nika",
            "display_name": "Nika Ross",
            "password": "viewer123",
            "focus_area": "Read-only stakeholder",
            "color_hex": "#7c3aed",
        },
    ]

    with SessionLocal() as db:
        existing = db.scalars(select(Member)).first()
        if existing is not None:
            return

        for member in demo_members:
            db.add(
                Member(
                    email=member["email"],
                    username=member["username"],
                    display_name=member["display_name"],
                    password_hash=hash_password(member["password"]),
                    focus_area=member["focus_area"],
                    color_hex=member["color_hex"],
                )
            )
        db.commit()

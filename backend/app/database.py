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
    members_columns = {
        column["name"] for column in inspector.get_columns("members")
    } if inspector.has_table("members") else set()
    assistant_runs_columns = {
        column["name"] for column in inspector.get_columns("assistant_runs")
    } if inspector.has_table("assistant_runs") else set()

    schema_is_current = (
        inspector.has_table("members")
        and inspector.has_table("drafts")
        and inspector.has_table("draft_collaborators")
        and inspector.has_table("draft_snapshots")
        and inspector.has_table("assistant_runs")
        and "display_name" in members_columns
        and "decision" in assistant_runs_columns
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

    demo_members = [
        {
            "email": "maya@draftdeck.local",
            "display_name": "Maya Stone",
            "focus_area": "Product lead",
            "color_hex": "#d97706",
        },
        {
            "email": "omar@draftdeck.local",
            "display_name": "Omar Vale",
            "focus_area": "Research editor",
            "color_hex": "#0f766e",
        },
        {
            "email": "irene@draftdeck.local",
            "display_name": "Irene Park",
            "focus_area": "Content reviewer",
            "color_hex": "#2563eb",
        },
        {
            "email": "nika@draftdeck.local",
            "display_name": "Nika Ross",
            "focus_area": "Read-only stakeholder",
            "color_hex": "#7c3aed",
        },
    ]

    with SessionLocal() as db:
        existing = db.scalars(select(Member)).first()
        if existing is not None:
            return

        for member in demo_members:
            db.add(Member(**member))
        db.commit()

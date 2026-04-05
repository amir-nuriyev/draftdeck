from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Member(Base):
    __tablename__ = "members"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(200))
    focus_area: Mapped[str] = mapped_column(String(200), default="")
    color_hex: Mapped[str] = mapped_column(String(20), default="#1f2937")

    owned_drafts: Mapped[list["Draft"]] = relationship(
        back_populates="owner",
        cascade="all, delete-orphan",
        foreign_keys="Draft.owner_id",
    )
    collaborations: Mapped[list["DraftCollaborator"]] = relationship(
        back_populates="member",
        cascade="all, delete-orphan",
    )
    assistant_runs: Mapped[list["AssistantRun"]] = relationship(
        back_populates="member",
    )


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    brief: Mapped[str] = mapped_column(String(500), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    stage: Mapped[str] = mapped_column(String(30), default="concept")
    accent: Mapped[str] = mapped_column(String(40), default="ember")
    owner_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    owner: Mapped["Member"] = relationship(
        back_populates="owned_drafts",
        foreign_keys=[owner_id],
    )
    snapshots: Mapped[list["DraftSnapshot"]] = relationship(
        back_populates="draft",
        cascade="all, delete-orphan",
    )
    collaborators: Mapped[list["DraftCollaborator"]] = relationship(
        back_populates="draft",
        cascade="all, delete-orphan",
    )
    assistant_runs: Mapped[list["AssistantRun"]] = relationship(
        back_populates="draft",
        cascade="all, delete-orphan",
    )


class DraftCollaborator(Base):
    __tablename__ = "draft_collaborators"
    __table_args__ = (
        UniqueConstraint("draft_id", "member_id", name="uq_draft_collaborator"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    draft_id: Mapped[int] = mapped_column(
        ForeignKey("drafts.id", ondelete="CASCADE"),
        index=True,
    )
    member_id: Mapped[int] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"),
        index=True,
    )
    role: Mapped[str] = mapped_column(String(20))

    draft: Mapped["Draft"] = relationship(back_populates="collaborators")
    member: Mapped["Member"] = relationship(back_populates="collaborations")


class DraftSnapshot(Base):
    __tablename__ = "draft_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    draft_id: Mapped[int] = mapped_column(
        ForeignKey("drafts.id", ondelete="CASCADE")
    )
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    draft: Mapped["Draft"] = relationship(back_populates="snapshots")


class AssistantRun(Base):
    __tablename__ = "assistant_runs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    draft_id: Mapped[int | None] = mapped_column(
        ForeignKey("drafts.id", ondelete="SET NULL"),
        nullable=True,
    )
    member_id: Mapped[int | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL"),
        nullable=True,
    )
    feature: Mapped[str] = mapped_column(String(50))
    selection_text: Mapped[str] = mapped_column(Text)
    context_excerpt: Mapped[str] = mapped_column(Text, default="")
    result_text: Mapped[str] = mapped_column(Text)
    model_route: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30), default="completed")
    decision: Mapped[str] = mapped_column(String(30), default="pending")
    target_language: Mapped[str | None] = mapped_column(String(80), nullable=True)
    selection_start: Mapped[int | None] = mapped_column(nullable=True)
    selection_end: Mapped[int | None] = mapped_column(nullable=True)
    applied_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    draft: Mapped["Draft | None"] = relationship(back_populates="assistant_runs")
    member: Mapped["Member | None"] = relationship(back_populates="assistant_runs")

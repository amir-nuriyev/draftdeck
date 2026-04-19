from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Member(Base):
    __tablename__ = "members"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    focus_area: Mapped[str] = mapped_column(String(200), default="")
    color_hex: Mapped[str] = mapped_column(String(20), default="#1f2937")
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

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
    refresh_sessions: Mapped[list["RefreshSession"]] = relationship(
        back_populates="member",
        cascade="all, delete-orphan",
    )
    draft_versions: Mapped[list["DraftVersion"]] = relationship(
        back_populates="created_by_member",
    )
    share_links: Mapped[list["ShareLink"]] = relationship(
        back_populates="created_by_member",
    )


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"
    __table_args__ = (
        UniqueConstraint("token_jti", name="uq_refresh_session_jti"),
        UniqueConstraint("token_hash", name="uq_refresh_session_hash"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"),
        index=True,
    )
    token_jti: Mapped[str] = mapped_column(String(120))
    token_hash: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    member: Mapped["Member"] = relationship(back_populates="refresh_sessions")


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    brief: Mapped[str] = mapped_column(String(500), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    plain_content: Mapped[str] = mapped_column(Text, default="")
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
    versions: Mapped[list["DraftVersion"]] = relationship(
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
    share_links: Mapped[list["ShareLink"]] = relationship(
        back_populates="draft",
        cascade="all, delete-orphan",
    )


class DraftVersion(Base):
    __tablename__ = "draft_versions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("drafts.id", ondelete="CASCADE"), index=True)
    created_by_member_id: Mapped[int | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL"),
        nullable=True,
    )
    reason: Mapped[str] = mapped_column(String(80), default="autosave")
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    content: Mapped[str] = mapped_column(Text, default="")
    plain_content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    draft: Mapped["Draft"] = relationship(back_populates="versions")
    created_by_member: Mapped["Member | None"] = relationship(back_populates="draft_versions")


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
    draft_id: Mapped[int] = mapped_column(ForeignKey("drafts.id", ondelete="CASCADE"))
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    plain_content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    draft: Mapped["Draft"] = relationship(back_populates="snapshots")


class ShareLink(Base):
    __tablename__ = "share_links"
    __table_args__ = (
        UniqueConstraint("token", name="uq_share_links_token"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("drafts.id", ondelete="CASCADE"), index=True)
    created_by_member_id: Mapped[int] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"),
        index=True,
    )
    token: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20), default="viewer")
    access_mode: Mapped[str] = mapped_column(String(20), default="authenticated")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    draft: Mapped["Draft"] = relationship(back_populates="share_links")
    created_by_member: Mapped["Member"] = relationship(back_populates="share_links")


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
    prompt_text: Mapped[str] = mapped_column(Text, default="")
    result_text: Mapped[str] = mapped_column(Text, default="")
    model_route: Mapped[str] = mapped_column(String(100))
    provider: Mapped[str] = mapped_column(String(80), default="lm-studio")
    status: Mapped[str] = mapped_column(String(30), default="completed")
    decision: Mapped[str] = mapped_column(String(30), default="pending")
    target_language: Mapped[str | None] = mapped_column(String(80), nullable=True)
    selection_start: Mapped[int | None] = mapped_column(nullable=True)
    selection_end: Mapped[int | None] = mapped_column(nullable=True)
    applied_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    draft: Mapped["Draft | None"] = relationship(back_populates="assistant_runs")
    member: Mapped["Member | None"] = relationship(back_populates="assistant_runs")


Index("ix_share_links_draft_revoked", ShareLink.draft_id, ShareLink.revoked_at)

from __future__ import annotations

from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import (
    build_brief,
    get_current_member,
    get_draft_role,
    require_draft_role,
    strip_rich_text,
)
from app.models import (
    Draft,
    DraftCollaborator,
    DraftSnapshot,
    DraftVersion,
    Member,
    ShareLink,
)
from app.schemas import (
    CollaboratorCreate,
    CollaboratorRead,
    DraftCreate,
    DraftRead,
    DraftSummaryRead,
    DraftUpdate,
    ShareLinkCreate,
    ShareLinkRead,
    SnapshotCreate,
    SnapshotRead,
)

router = APIRouter(prefix="/drafts", tags=["drafts"])


def accessible_drafts_statement(member_id: int):
    return (
        select(Draft)
        .outerjoin(DraftCollaborator, DraftCollaborator.draft_id == Draft.id)
        .where(
            or_(
                Draft.owner_id == member_id,
                DraftCollaborator.member_id == member_id,
            )
        )
        .order_by(Draft.updated_at.desc(), Draft.id.desc())
        .distinct()
    )


def get_draft_or_404(draft_id: int, db: Session) -> Draft:
    draft = db.get(Draft, draft_id)
    if draft is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Draft not found.",
        )
    return draft


def serialize_draft(draft: Draft, my_role: str) -> DraftRead:
    owner_name = draft.owner.display_name if draft.owner is not None else "Unknown owner"
    return DraftRead(
        id=draft.id,
        title=draft.title,
        brief=draft.brief,
        content=draft.content,
        plain_content=draft.plain_content,
        stage=draft.stage,
        accent=draft.accent,
        owner_id=draft.owner_id,
        owner_name=owner_name,
        my_role=my_role,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


def serialize_summary(draft: Draft, my_role: str) -> DraftSummaryRead:
    owner_name = draft.owner.display_name if draft.owner is not None else "Unknown owner"
    return DraftSummaryRead(
        id=draft.id,
        title=draft.title,
        brief=draft.brief,
        stage=draft.stage,
        accent=draft.accent,
        owner_id=draft.owner_id,
        owner_name=owner_name,
        my_role=my_role,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


def serialize_snapshot(snapshot: DraftSnapshot) -> SnapshotRead:
    return SnapshotRead.model_validate(snapshot)


def serialize_collaborator(collaborator: DraftCollaborator) -> CollaboratorRead:
    member = collaborator.member
    return CollaboratorRead(
        id=collaborator.id,
        draft_id=collaborator.draft_id,
        member_id=collaborator.member_id,
        role=collaborator.role,
        display_name=member.display_name if member is not None else "Unknown member",
        email=member.email if member is not None else "",
        username=member.username if member is not None else "",
        focus_area=member.focus_area if member is not None else "",
        color_hex=member.color_hex if member is not None else "#000000",
    )


def serialize_share_link(link: ShareLink) -> ShareLinkRead:
    return ShareLinkRead.model_validate(link)


def safe_export_filename(title: str, export_format: str) -> str:
    collapsed = "-".join(title.lower().split()) or "draft"
    sanitized = "".join(
        character for character in collapsed if character.isalnum() or character in {"-", "_"}
    ).strip("-_")
    stem = sanitized or "draft"
    return f"{stem}.{export_format}"


def add_draft_version(
    db: Session,
    draft: Draft,
    *,
    member_id: int | None,
    reason: str,
    label: str | None = None,
) -> None:
    db.add(
        DraftVersion(
            draft_id=draft.id,
            created_by_member_id=member_id,
            reason=reason,
            label=label,
            content=draft.content,
            plain_content=draft.plain_content,
        )
    )


@router.get("", response_model=list[DraftSummaryRead], summary="List accessible drafts")
def list_drafts(
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    drafts = db.scalars(accessible_drafts_statement(current_member.id)).all()
    return [
        serialize_summary(draft, get_draft_role(draft, current_member, db) or "viewer")
        for draft in drafts
    ]


@router.post("", response_model=DraftRead, status_code=status.HTTP_201_CREATED, summary="Create draft")
def create_draft(
    payload: DraftCreate,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    plain_content = strip_rich_text(payload.content)
    draft = Draft(
        title=payload.title,
        brief=payload.brief.strip() or build_brief(plain_content, payload.title),
        content=payload.content,
        plain_content=plain_content,
        stage=payload.stage,
        accent=payload.accent,
        owner_id=current_member.id,
    )
    db.add(draft)
    db.flush()
    add_draft_version(
        db,
        draft,
        member_id=current_member.id,
        reason="created",
        label="Initial draft",
    )

    if payload.create_snapshot:
        db.add(
            DraftSnapshot(
                draft_id=draft.id,
                label="Kickoff snapshot",
                content=draft.content,
                plain_content=draft.plain_content,
            )
        )

    db.commit()
    db.refresh(draft)
    return serialize_draft(draft, "owner")


@router.get("/{draft_id}", response_model=DraftRead, summary="Get draft")
def get_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    my_role = require_draft_role(
        draft,
        current_member,
        db,
        {"owner", "editor", "commenter", "viewer"},
    )
    return serialize_draft(draft, my_role)


@router.patch("/{draft_id}", response_model=DraftRead, summary="Update draft")
def update_draft(
    draft_id: int,
    payload: DraftUpdate,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    my_role = require_draft_role(draft, current_member, db, {"owner", "editor"})

    if payload.title is not None:
        draft.title = payload.title
    if payload.brief is not None:
        draft.brief = payload.brief.strip()
    if payload.content is not None:
        draft.content = payload.content
        draft.plain_content = strip_rich_text(payload.content)
    if payload.stage is not None:
        draft.stage = payload.stage
    if payload.accent is not None:
        draft.accent = payload.accent

    if not draft.brief.strip():
        draft.brief = build_brief(draft.plain_content, draft.title)

    if payload.create_snapshot:
        db.add(
            DraftSnapshot(
                draft_id=draft.id,
                label=payload.snapshot_label or "Manual checkpoint",
                content=draft.content,
                plain_content=draft.plain_content,
            )
        )

    add_draft_version(
        db,
        draft,
        member_id=current_member.id,
        reason="updated",
        label=payload.snapshot_label,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return serialize_draft(draft, my_role)


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete draft")
def delete_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(draft, current_member, db, {"owner"})
    db.delete(draft)
    db.commit()


@router.get("/{draft_id}/snapshots", response_model=list[SnapshotRead], summary="List snapshots")
def list_snapshots(
    draft_id: int,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(
        draft,
        current_member,
        db,
        {"owner", "editor", "commenter", "viewer"},
    )
    snapshots = db.scalars(
        select(DraftSnapshot)
        .where(DraftSnapshot.draft_id == draft_id)
        .order_by(DraftSnapshot.created_at.desc(), DraftSnapshot.id.desc())
    ).all()
    return [serialize_snapshot(snapshot) for snapshot in snapshots]


@router.post(
    "/{draft_id}/snapshots",
    response_model=SnapshotRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create snapshot",
)
def create_snapshot(
    draft_id: int,
    payload: SnapshotCreate,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(draft, current_member, db, {"owner", "editor"})

    snapshot = DraftSnapshot(
        draft_id=draft.id,
        label=payload.label or "Manual checkpoint",
        content=draft.content,
        plain_content=draft.plain_content,
    )
    db.add(snapshot)
    add_draft_version(
        db,
        draft,
        member_id=current_member.id,
        reason="snapshot",
        label=snapshot.label,
    )
    db.commit()
    db.refresh(snapshot)
    return serialize_snapshot(snapshot)


@router.post("/{draft_id}/snapshots/{snapshot_id}/restore", response_model=DraftRead, summary="Restore snapshot")
def restore_snapshot(
    draft_id: int,
    snapshot_id: int,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(draft, current_member, db, {"owner"})

    snapshot = db.scalar(
        select(DraftSnapshot).where(
            DraftSnapshot.id == snapshot_id,
            DraftSnapshot.draft_id == draft_id,
        )
    )
    if snapshot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snapshot not found for this draft.",
        )

    draft.content = snapshot.content
    draft.plain_content = snapshot.plain_content
    draft.brief = build_brief(draft.plain_content, draft.title)
    db.add(
        DraftSnapshot(
            draft_id=draft.id,
            label=f"Restored from snapshot {snapshot.id}",
            content=draft.content,
            plain_content=draft.plain_content,
        )
    )
    add_draft_version(
        db,
        draft,
        member_id=current_member.id,
        reason="restore",
        label=f"Restored snapshot {snapshot.id}",
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return serialize_draft(draft, "owner")


@router.get("/{draft_id}/collaborators", response_model=list[CollaboratorRead], summary="List collaborators")
def list_collaborators(
    draft_id: int,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(
        draft,
        current_member,
        db,
        {"owner", "editor", "commenter", "viewer"},
    )
    collaborators = db.scalars(
        select(DraftCollaborator)
        .where(DraftCollaborator.draft_id == draft_id)
        .order_by(DraftCollaborator.member_id.asc())
    ).all()
    return [serialize_collaborator(collaborator) for collaborator in collaborators]


@router.post(
    "/{draft_id}/collaborators",
    response_model=CollaboratorRead,
    status_code=status.HTTP_201_CREATED,
    summary="Share draft with collaborator",
)
def upsert_collaborator(
    draft_id: int,
    payload: CollaboratorCreate,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(draft, current_member, db, {"owner"})

    member = db.get(Member, payload.member_id)
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target member not found.",
        )

    if member.id == draft.owner_id and payload.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The draft owner must keep the owner role.",
        )

    collaborator = db.scalar(
        select(DraftCollaborator).where(
            DraftCollaborator.draft_id == draft_id,
            DraftCollaborator.member_id == payload.member_id,
        )
    )

    if collaborator is None:
        collaborator = DraftCollaborator(
            draft_id=draft_id,
            member_id=payload.member_id,
            role=payload.role,
        )
        db.add(collaborator)
    else:
        collaborator.role = payload.role
        db.add(collaborator)

    db.commit()
    db.refresh(collaborator)
    return serialize_collaborator(collaborator)


@router.delete("/{draft_id}/collaborators/{member_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Remove collaborator")
def delete_collaborator(
    draft_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(draft, current_member, db, {"owner"})

    if member_id == draft.owner_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Owner access cannot be removed.",
        )

    collaborator = db.scalar(
        select(DraftCollaborator).where(
            DraftCollaborator.draft_id == draft_id,
            DraftCollaborator.member_id == member_id,
        )
    )
    if collaborator is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collaborator not found.",
        )

    db.delete(collaborator)
    db.commit()


@router.get("/{draft_id}/share-links", response_model=list[ShareLinkRead], summary="List share links")
def list_share_links(
    draft_id: int,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(draft, current_member, db, {"owner"})
    links = db.scalars(
        select(ShareLink)
        .where(ShareLink.draft_id == draft_id)
        .order_by(ShareLink.created_at.desc(), ShareLink.id.desc())
    ).all()
    return [serialize_share_link(link) for link in links]


@router.post(
    "/{draft_id}/share-links",
    response_model=ShareLinkRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create share-by-link rule",
)
def create_share_link(
    draft_id: int,
    payload: ShareLinkCreate,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(draft, current_member, db, {"owner"})

    role = payload.role
    if payload.access_mode == "public" and role in {"owner", "editor"}:
        role = "viewer"

    link = ShareLink(
        draft_id=draft_id,
        created_by_member_id=current_member.id,
        token=token_urlsafe(32),
        role=role,
        access_mode=payload.access_mode,
        expires_at=payload.expires_at,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return serialize_share_link(link)


@router.delete("/{draft_id}/share-links/{link_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke share link")
def revoke_share_link(
    draft_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(draft, current_member, db, {"owner"})
    link = db.get(ShareLink, link_id)
    if link is None or link.draft_id != draft_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found.")
    if link.revoked_at is None:
        from app.security import utc_now

        link.revoked_at = utc_now()
        db.add(link)
        db.commit()


@router.get("/{draft_id}/export", summary="Export draft")
def export_draft(
    draft_id: int,
    format: str = Query(default="md"),
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(
        draft,
        current_member,
        db,
        {"owner", "editor", "commenter", "viewer"},
    )

    export_format = format.lower().strip()
    if export_format not in {"txt", "md", "json"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported export format. Use txt, md, or json.",
        )

    filename = safe_export_filename(draft.title, export_format)

    if export_format == "json":
        payload = {
            "id": draft.id,
            "title": draft.title,
            "brief": draft.brief,
            "content": draft.content,
            "plain_content": draft.plain_content,
            "stage": draft.stage,
            "accent": draft.accent,
            "created_at": draft.created_at.isoformat(),
            "updated_at": draft.updated_at.isoformat(),
        }
        return JSONResponse(
            payload,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    body_source = draft.plain_content if draft.plain_content.strip() else strip_rich_text(draft.content)
    body = body_source if export_format == "txt" else f"# {draft.title}\n\n{body_source}"
    return PlainTextResponse(
        body,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

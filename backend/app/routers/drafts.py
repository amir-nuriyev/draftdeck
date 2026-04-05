from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import build_brief, get_current_member, get_draft_role, require_draft_role
from app.models import Draft, DraftCollaborator, DraftSnapshot, Member
from app.schemas import (
    CollaboratorCreate,
    CollaboratorRead,
    DraftCreate,
    DraftRead,
    DraftSummaryRead,
    DraftUpdate,
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
        focus_area=member.focus_area if member is not None else "",
        color_hex=member.color_hex if member is not None else "#000000",
    )


def safe_export_filename(title: str, export_format: str) -> str:
    collapsed = "-".join(title.lower().split()) or "draft"
    sanitized = "".join(
        character for character in collapsed if character.isalnum() or character in {"-", "_"}
    ).strip("-_")
    stem = sanitized or "draft"
    return f"{stem}.{export_format}"


@router.get("", response_model=list[DraftSummaryRead])
def list_drafts(
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    drafts = db.scalars(accessible_drafts_statement(current_member.id)).all()
    return [
        serialize_summary(draft, get_draft_role(draft, current_member, db) or "viewer")
        for draft in drafts
    ]


@router.post("", response_model=DraftRead, status_code=status.HTTP_201_CREATED)
def create_draft(
    payload: DraftCreate,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = Draft(
        title=payload.title,
        brief=payload.brief.strip() or build_brief(payload.content, payload.title),
        content=payload.content,
        stage=payload.stage,
        accent=payload.accent,
        owner_id=current_member.id,
    )
    db.add(draft)
    db.flush()

    if payload.create_snapshot:
        db.add(
            DraftSnapshot(
                draft_id=draft.id,
                label="Kickoff snapshot",
                content=draft.content,
            )
        )

    db.commit()
    db.refresh(draft)
    return serialize_draft(draft, "owner")


@router.get("/{draft_id}", response_model=DraftRead)
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


@router.patch("/{draft_id}", response_model=DraftRead)
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
        draft.brief = payload.brief.strip() or build_brief(draft.content, draft.title)
    if payload.content is not None:
        draft.content = payload.content
    if payload.stage is not None:
        draft.stage = payload.stage
    if payload.accent is not None:
        draft.accent = payload.accent

    if payload.content is not None and payload.brief is None and not draft.brief.strip():
        draft.brief = build_brief(payload.content, draft.title)

    if payload.create_snapshot:
        db.add(
            DraftSnapshot(
                draft_id=draft.id,
                label=payload.snapshot_label or "Manual checkpoint",
                content=draft.content,
            )
        )

    db.add(draft)
    db.commit()
    db.refresh(draft)
    return serialize_draft(draft, my_role)


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft = get_draft_or_404(draft_id, db)
    require_draft_role(draft, current_member, db, {"owner"})
    db.delete(draft)
    db.commit()


@router.get("/{draft_id}/snapshots", response_model=list[SnapshotRead])
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
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return serialize_snapshot(snapshot)


@router.post("/{draft_id}/snapshots/{snapshot_id}/restore", response_model=DraftRead)
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
    draft.brief = build_brief(snapshot.content, draft.title)
    db.add(
        DraftSnapshot(
            draft_id=draft.id,
            label=f"Restored from snapshot {snapshot.id}",
            content=draft.content,
        )
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return serialize_draft(draft, "owner")


@router.get("/{draft_id}/collaborators", response_model=list[CollaboratorRead])
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


@router.delete("/{draft_id}/collaborators/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
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


@router.get("/{draft_id}/export")
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
            "stage": draft.stage,
            "accent": draft.accent,
            "created_at": draft.created_at.isoformat(),
            "updated_at": draft.updated_at.isoformat(),
        }
        return JSONResponse(
            payload,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    body = draft.content if export_format == "txt" else f"# {draft.title}\n\n{draft.content}"
    return PlainTextResponse(
        body,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

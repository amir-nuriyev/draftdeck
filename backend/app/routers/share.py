from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_optional_current_member, get_draft_role
from app.models import Draft, DraftCollaborator, Member, ShareLink
from app.schemas import DraftRead, ShareResolveRead
from app.security import utc_now

router = APIRouter(prefix="/share", tags=["share"])


def _serialize_draft(draft: Draft, my_role: str) -> DraftRead:
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


def _role_rank(role: str) -> int:
    ranks = {"viewer": 1, "commenter": 2, "editor": 3, "owner": 4}
    return ranks.get(role, 0)


@router.get("/{token}/resolve", response_model=ShareResolveRead, summary="Resolve share link")
def resolve_share_link(
    token: str,
    db: Session = Depends(get_db),
    current_member: Member | None = Depends(get_optional_current_member),
):
    link = db.scalar(select(ShareLink).where(ShareLink.token == token))
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found.")
    if link.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Share link has been revoked.")
    if link.expires_at is not None and link.expires_at <= utc_now():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Share link has expired.")

    draft = db.get(Draft, link.draft_id)
    if draft is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found.")

    if link.access_mode == "authenticated" and current_member is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication is required for this share link.",
        )

    if current_member is None:
        granted_role = link.role
        if granted_role in {"owner", "editor"}:
            granted_role = "viewer"
        return ShareResolveRead(
            draft=_serialize_draft(draft, granted_role),
            granted_role=granted_role,
            access_mode=link.access_mode,
        )

    existing_role = get_draft_role(draft, current_member, db)
    if existing_role == "owner":
        granted_role = "owner"
    else:
        granted_role = link.role
        if link.access_mode == "public" and granted_role in {"owner", "editor"}:
            granted_role = "viewer"
        if existing_role and _role_rank(existing_role) > _role_rank(granted_role):
            granted_role = existing_role
        collaborator = db.scalar(
            select(DraftCollaborator).where(
                DraftCollaborator.draft_id == draft.id,
                DraftCollaborator.member_id == current_member.id,
            )
        )
        if current_member.id != draft.owner_id:
            if collaborator is None:
                collaborator = DraftCollaborator(
                    draft_id=draft.id,
                    member_id=current_member.id,
                    role=granted_role,
                )
                db.add(collaborator)
                db.commit()
            elif collaborator.role != granted_role:
                collaborator.role = granted_role
                db.add(collaborator)
                db.commit()

    return ShareResolveRead(
        draft=_serialize_draft(draft, granted_role),
        granted_role=granted_role,
        access_mode=link.access_mode,
    )

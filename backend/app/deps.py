from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Draft, DraftCollaborator, Member


def get_current_member(
    x_user_id: int | None = Header(default=1, alias="X-User-Id"),
    db: Session = Depends(get_db),
) -> Member:
    member = db.get(Member, x_user_id)
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-User-Id header.",
        )
    return member


def get_draft_role(draft: Draft, member: Member, db: Session) -> str | None:
    if draft.owner_id == member.id:
        return "owner"

    collaborator = db.scalar(
        select(DraftCollaborator).where(
            DraftCollaborator.draft_id == draft.id,
            DraftCollaborator.member_id == member.id,
        )
    )
    return collaborator.role if collaborator else None


def require_draft_role(
    draft: Draft,
    member: Member,
    db: Session,
    allowed_roles: set[str],
) -> str:
    role = get_draft_role(draft, member, db)
    if role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action in this draft.",
        )
    return role


def build_brief(text: str, fallback_title: str = "Untitled draft") -> str:
    compact = " ".join(text.split()).strip()
    if not compact:
        return f"{fallback_title} is ready for the next writing pass."
    return compact[:157] + "..." if len(compact) > 160 else compact

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import capability_flags, get_current_member, get_draft_role
from app.models import Draft, Member
from app.schemas import SessionRead

router = APIRouter(prefix="/session", tags=["session"])


@router.get("", response_model=SessionRead)
def get_session(
    draft_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    draft_role = None
    if draft_id is not None:
        draft = db.get(Draft, draft_id)
        if draft is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Draft not found.",
            )
        draft_role = get_draft_role(draft, current_member, db)
        if draft_role is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this draft session.",
            )

    return SessionRead(
        auth_mode="demo-header",
        member=current_member,
        draft_id=draft_id,
        draft_role=draft_role,
        capabilities=capability_flags(draft_role),
    )

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_member
from app.models import Member
from app.schemas import MemberRead

router = APIRouter(prefix="/members", tags=["members"])


@router.get("", response_model=list[MemberRead])
def list_members(
    db: Session = Depends(get_db),
    _: Member = Depends(get_current_member),
):
    return db.scalars(select(Member).order_by(Member.id.asc())).all()


@router.get("/me", response_model=MemberRead)
def get_me(current_member: Member = Depends(get_current_member)):
    return current_member

from collections import Counter

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_member
from app.models import Member
from app.routers.drafts import accessible_drafts_statement
from app.schemas import StudioOverviewRead

router = APIRouter(prefix="/studio", tags=["studio"])


@router.get("/overview", response_model=StudioOverviewRead)
def get_overview(
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    drafts = db.scalars(accessible_drafts_statement(current_member.id)).all()
    stage_counts = Counter(draft.stage for draft in drafts)
    members = db.query(Member).count()
    return StudioOverviewRead(
        app_name=settings.app_name,
        accessible_drafts=len(drafts),
        concept_count=stage_counts.get("concept", 0),
        drafting_count=stage_counts.get("drafting", 0),
        review_count=stage_counts.get("review", 0),
        active_members=members,
        assistant_mode="mock" if settings.llm_mock else "live",
    )

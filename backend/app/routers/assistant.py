from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_member, get_draft_role, require_draft_role
from app.models import AssistantRun, Draft, DraftCollaborator, Member
from app.schemas import (
    AssistantRunDecisionUpdate,
    AssistantRunRead,
    AssistantSuggestRequest,
    AssistantSuggestResponse,
)
from app.services import build_lm_studio_chat_url, generate_ai_suggestion, sanitize_model_output

router = APIRouter(prefix="/assistant", tags=["assistant"])


def serialize_run(run: AssistantRun) -> AssistantRunRead:
    member_display_name = run.member.display_name if run.member is not None else None
    return AssistantRunRead(
        id=run.id,
        draft_id=run.draft_id,
        member_id=run.member_id,
        member_display_name=member_display_name,
        feature=run.feature,
        selection_text=run.selection_text,
        context_excerpt=run.context_excerpt,
        result_text=run.result_text,
        model_route=run.model_route,
        status=run.status,
        decision=run.decision,
        target_language=run.target_language,
        selection_start=run.selection_start,
        selection_end=run.selection_end,
        applied_excerpt=run.applied_excerpt,
        created_at=run.created_at,
    )


def can_update_run(run: AssistantRun, member: Member, db: Session) -> bool:
    if run.member_id == member.id:
        return True
    if run.draft_id is None:
        return False

    draft = db.get(Draft, run.draft_id)
    if draft is None:
        return False

    role = get_draft_role(draft, member, db)
    return role in {"owner", "editor"}


@router.post("/suggest", response_model=AssistantSuggestResponse)
async def request_suggestion(
    payload: AssistantSuggestRequest,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    if payload.draft_id is not None:
        draft = db.get(Draft, payload.draft_id)
        if draft is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Draft not found.",
            )
        require_draft_role(draft, current_member, db, {"owner", "editor"})

    result = await generate_ai_suggestion(payload)
    run = AssistantRun(
        draft_id=payload.draft_id,
        member_id=current_member.id,
        feature=payload.feature,
        selection_text=payload.selected_text,
        context_excerpt=payload.surrounding_context,
        result_text=result.output_text,
        model_route=result.model_name,
        status="completed",
        decision="pending",
        target_language=payload.target_language,
        selection_start=payload.selection_start,
        selection_end=payload.selection_end,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    return AssistantSuggestResponse(
        run_id=run.id,
        feature=payload.feature,
        suggestion_text=result.output_text,
        model_name=result.model_name,
        provider=result.provider,
        status=run.status,
        mocked=result.mocked,
        decision=run.decision,
    )


@router.get("/runs", response_model=list[AssistantRunRead])
def list_runs(
    draft_id: int | None = Query(default=None),
    feature: str | None = Query(default=None),
    limit: int = Query(default=40, ge=1, le=200),
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    statement = select(AssistantRun)

    if draft_id is not None:
        draft = db.get(Draft, draft_id)
        if draft is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Draft not found.",
            )
        require_draft_role(
            draft,
            current_member,
            db,
            {"owner", "editor", "commenter", "viewer"},
        )
        statement = statement.where(AssistantRun.draft_id == draft_id)
    else:
        statement = statement.where(AssistantRun.member_id == current_member.id)

    if feature is not None:
        statement = statement.where(AssistantRun.feature == feature)

    statement = statement.order_by(AssistantRun.created_at.desc(), AssistantRun.id.desc()).limit(limit)
    return [serialize_run(run) for run in db.scalars(statement).all()]


@router.patch("/runs/{run_id}", response_model=AssistantRunRead)
def update_run_decision(
    run_id: int,
    payload: AssistantRunDecisionUpdate,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    run = db.get(AssistantRun, run_id)
    if run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assistant run not found.",
        )

    if not can_update_run(run, current_member, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot update this assistant run.",
        )

    run.decision = payload.decision
    run.applied_excerpt = payload.applied_excerpt
    db.add(run)
    db.commit()
    db.refresh(run)
    return serialize_run(run)


__all__ = ["router", "build_lm_studio_chat_url", "sanitize_model_output"]

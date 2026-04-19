from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.deps import get_current_member, get_draft_role, require_draft_role
from app.models import AssistantRun, Draft, Member
from app.schemas import (
    AssistantRunDecisionUpdate,
    AssistantRunRead,
    AssistantSuggestRequest,
    AssistantSuggestResponse,
)
from app.security import utc_now
from app.services import (
    build_lm_studio_chat_url,
    generate_ai_suggestion,
    sanitize_model_output,
    stream_ai_suggestion,
)

router = APIRouter(prefix="/assistant", tags=["assistant"])

RUN_CANCEL_EVENTS: dict[int, asyncio.Event] = {}


def serialize_run(run: AssistantRun) -> AssistantRunRead:
    member_display_name = run.member.display_name if run.member is not None else None
    return AssistantRunRead(
        id=run.id,
        draft_id=run.draft_id,
        member_id=run.member_id,
        member_display_name=member_display_name,
        feature=run.feature,  # type: ignore[arg-type]
        selection_text=run.selection_text,
        context_excerpt=run.context_excerpt,
        prompt_text=run.prompt_text,
        result_text=run.result_text,
        model_route=run.model_route,
        provider=run.provider,
        status=run.status,
        decision=run.decision,  # type: ignore[arg-type]
        target_language=run.target_language,
        selection_start=run.selection_start,
        selection_end=run.selection_end,
        applied_excerpt=run.applied_excerpt,
        canceled_at=run.canceled_at,
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


def _assert_assistant_access(payload: AssistantSuggestRequest, current_member: Member, db: Session) -> None:
    if payload.draft_id is not None:
        draft = db.get(Draft, payload.draft_id)
        if draft is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Draft not found.",
            )
        require_draft_role(draft, current_member, db, {"owner", "editor"})


@router.post("/suggest", response_model=AssistantSuggestResponse, summary="Request a complete assistant suggestion")
async def request_suggestion(
    payload: AssistantSuggestRequest,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    _assert_assistant_access(payload, current_member, db)
    result = await generate_ai_suggestion(payload)
    run = AssistantRun(
        draft_id=payload.draft_id,
        member_id=current_member.id,
        feature=payload.feature,
        selection_text=payload.selected_text,
        context_excerpt=payload.surrounding_context,
        prompt_text=result.prompt,
        result_text=result.output_text,
        model_route=result.model_name,
        provider=result.provider,
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
        decision=run.decision,  # type: ignore[arg-type]
    )


@router.post("/suggest/stream", summary="Stream assistant suggestion with SSE")
async def stream_suggestion(
    payload: AssistantSuggestRequest,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    _assert_assistant_access(payload, current_member, db)
    cancel_event = asyncio.Event()
    prompt, model_name, provider, mocked, chunk_iterator = await stream_ai_suggestion(payload, cancel_event)
    run = AssistantRun(
        draft_id=payload.draft_id,
        member_id=current_member.id,
        feature=payload.feature,
        selection_text=payload.selected_text,
        context_excerpt=payload.surrounding_context,
        prompt_text=prompt,
        result_text="",
        model_route=model_name,
        provider=provider,
        status="streaming",
        decision="pending",
        target_language=payload.target_language,
        selection_start=payload.selection_start,
        selection_end=payload.selection_end,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    RUN_CANCEL_EVENTS[run.id] = cancel_event

    async def event_stream() -> AsyncIterator[str]:
        text_chunks: list[str] = []
        status_value = "completed"
        decision_value = "pending"
        canceled_at = None
        error_message: str | None = None
        try:
            start_payload = {
                "run_id": run.id,
                "model_name": model_name,
                "provider": provider,
                "mocked": mocked,
            }
            yield f"event: start\ndata: {json.dumps(start_payload)}\n\n"
            async for chunk in chunk_iterator:
                if cancel_event.is_set():
                    status_value = "canceled"
                    decision_value = "canceled"
                    canceled_at = utc_now()
                    break
                text_chunks.append(chunk)
                yield f"event: chunk\ndata: {json.dumps({'text': chunk})}\n\n"

            if cancel_event.is_set():
                status_value = "canceled"
                decision_value = "canceled"
                canceled_at = utc_now()
                yield "event: canceled\ndata: {\"status\":\"canceled\"}\n\n"
            else:
                yield "event: done\ndata: {\"status\":\"completed\"}\n\n"
        except HTTPException as exc:
            status_value = "failed"
            decision_value = "rejected"
            error_message = exc.detail if isinstance(exc.detail, str) else "Streaming failed."
            yield f"event: error\ndata: {json.dumps({'message': error_message})}\n\n"
        except Exception as exc:  # noqa: BLE001
            status_value = "failed"
            decision_value = "rejected"
            error_message = str(exc)
            yield f"event: error\ndata: {json.dumps({'message': error_message})}\n\n"
        finally:
            RUN_CANCEL_EVENTS.pop(run.id, None)
            result_text = sanitize_model_output("".join(text_chunks))
            with SessionLocal() as write_db:
                stored = write_db.get(AssistantRun, run.id)
                if stored is not None:
                    stored.result_text = result_text
                    stored.status = status_value
                    stored.decision = decision_value
                    stored.canceled_at = canceled_at
                    write_db.add(stored)
                    write_db.commit()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/runs/{run_id}/cancel", summary="Cancel an in-progress assistant run")
def cancel_run(
    run_id: int,
    db: Session = Depends(get_db),
    current_member: Member = Depends(get_current_member),
):
    run = db.get(AssistantRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assistant run not found.")
    if not can_update_run(run, current_member, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot cancel this run.")

    cancel_event = RUN_CANCEL_EVENTS.get(run_id)
    if cancel_event is not None:
        cancel_event.set()
        return {"status": "cancel-requested", "run_id": run_id}
    return {"status": run.status, "run_id": run_id}


@router.get("/runs", response_model=list[AssistantRunRead], summary="List assistant runs")
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


@router.patch("/runs/{run_id}", response_model=AssistantRunRead, summary="Update assistant run decision")
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

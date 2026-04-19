from __future__ import annotations

import re

from fastapi import Depends, HTTPException, Query, Security, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Draft, DraftCollaborator, Member
from app.security import decode_token


http_bearer = HTTPBearer(auto_error=False)


def capability_flags(role: str | None) -> dict[str, bool]:
    return {
        "can_create_draft": True,
        "can_view_draft": role in {"owner", "editor", "commenter", "viewer"},
        "can_edit_draft": role in {"owner", "editor"},
        "can_use_assistant": role in {"owner", "editor"},
        "can_create_snapshot": role in {"owner", "editor"},
        "can_restore_snapshot": role == "owner",
        "can_manage_collaborators": role == "owner",
    }


def _member_from_access_token(token: str, db: Session) -> Member:
    payload = decode_token(token, expected_type="access")
    try:
        member_id = int(str(payload["sub"]))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject.",
        ) from exc

    member = db.get(Member, member_id)
    if member is None or not member.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive.",
        )
    return member


def get_current_member(
    credentials: HTTPAuthorizationCredentials | None = Security(http_bearer),
    db: Session = Depends(get_db),
) -> Member:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )
    return _member_from_access_token(credentials.credentials, db)


def get_optional_current_member(
    credentials: HTTPAuthorizationCredentials | None = Security(http_bearer),
    db: Session = Depends(get_db),
) -> Member | None:
    if credentials is None or not credentials.credentials:
        return None
    try:
        return _member_from_access_token(credentials.credentials, db)
    except HTTPException:
        return None


def get_member_from_ws_token(
    websocket: WebSocket,
    db: Session,
    *,
    token_query_name: str = "token",
) -> Member:
    token = websocket.query_params.get(token_query_name)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing websocket token.",
        )
    return _member_from_access_token(token, db)


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


def require_draft_access_for_ws(draft: Draft, member: Member, db: Session) -> str:
    role = get_draft_role(draft, member, db)
    if role not in {"owner", "editor", "commenter", "viewer"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No access to this draft room.",
        )
    return role


def build_brief(text: str, fallback_title: str = "Untitled draft") -> str:
    compact = " ".join(text.split()).strip()
    if not compact:
        return f"{fallback_title} is ready for the next writing pass."
    return compact[:157] + "..." if len(compact) > 160 else compact


def strip_rich_text(value: str) -> str:
    # Basic HTML-to-text normalization used for AI context and exports.
    without_tags = re.sub(r"<[^>]+>", " ", value)
    compact = re.sub(r"\s+", " ", without_tags).strip()
    return compact


def extract_share_token(token: str = Query(min_length=8)) -> str:
    return token.strip()

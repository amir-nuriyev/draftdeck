from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_member
from app.models import Member, RefreshSession
from app.schemas import (
    AuthLoginRequest,
    AuthLogoutRequest,
    AuthRefreshRequest,
    AuthRegisterRequest,
    AuthTokenRead,
    MemberRead,
)
from app.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_response_for_member(member: Member, db: Session) -> AuthTokenRead:
    access_token = create_access_token(member.id)
    refresh_bundle = create_refresh_token(member.id)
    db.add(
        RefreshSession(
            member_id=member.id,
            token_jti=refresh_bundle.jti,
            token_hash=hash_refresh_token(refresh_bundle.token),
            expires_at=refresh_bundle.expires_at,
        )
    )
    db.commit()
    return AuthTokenRead(
        access_token=access_token,
        refresh_token=refresh_bundle.token,
        access_expires_in=20 * 60,
    )


@router.post("/register", response_model=AuthTokenRead, status_code=status.HTTP_201_CREATED)
def register(
    payload: AuthRegisterRequest,
    db: Session = Depends(get_db),
):
    existing = db.scalar(
        select(Member).where(
            or_(
                Member.email == payload.email.lower().strip(),
                Member.username == payload.username.lower().strip(),
            )
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email or username already in use.",
        )

    member = Member(
        email=payload.email.lower().strip(),
        username=payload.username.lower().strip(),
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        focus_area="",
        color_hex="#1f2937",
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return _token_response_for_member(member, db)


@router.post("/login", response_model=AuthTokenRead)
def login(
    payload: AuthLoginRequest,
    db: Session = Depends(get_db),
):
    login_value = payload.login.lower().strip()
    member = db.scalar(
        select(Member).where(
            or_(
                Member.email == login_value,
                Member.username == login_value,
            )
        )
    )
    if member is None or not member.is_active or not verify_password(payload.password, member.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid login credentials.",
        )
    return _token_response_for_member(member, db)


@router.post("/refresh", response_model=AuthTokenRead)
def refresh_token(
    payload: AuthRefreshRequest,
    db: Session = Depends(get_db),
):
    claims = decode_token(payload.refresh_token, expected_type="refresh")
    jti = str(claims.get("jti") or "")
    token_hash = hash_refresh_token(payload.refresh_token)
    session = db.scalar(
        select(RefreshSession).where(
            RefreshSession.token_jti == jti,
            RefreshSession.token_hash == token_hash,
        )
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh session not found.")

    now = datetime.now(tz=UTC)
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if session.revoked_at is not None or expires_at <= now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired or revoked.")

    member = db.get(Member, session.member_id)
    if member is None or not member.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is inactive.")

    session.revoked_at = now
    session.last_used_at = now
    db.add(session)
    db.commit()
    return _token_response_for_member(member, db)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    payload: AuthLogoutRequest,
    db: Session = Depends(get_db),
):
    try:
        claims = decode_token(payload.refresh_token, expected_type="refresh")
        jti = str(claims.get("jti") or "")
    except HTTPException:
        return

    token_hash = hash_refresh_token(payload.refresh_token)
    session = db.scalar(
        select(RefreshSession).where(
            RefreshSession.token_jti == jti,
            RefreshSession.token_hash == token_hash,
        )
    )
    if session is None:
        return

    session.revoked_at = datetime.now(tz=UTC)
    db.add(session)
    db.commit()


@router.get("/me", response_model=MemberRead)
def me(current_member: Member = Depends(get_current_member)):
    return current_member

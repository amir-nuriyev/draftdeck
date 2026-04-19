from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import pbkdf2_hmac
from hashlib import sha256
from hmac import compare_digest
from os import urandom
from uuid import uuid4

import jwt
from fastapi import HTTPException, status

from app.config import settings


@dataclass(slots=True)
class RefreshTokenBundle:
    token: str
    jti: str
    expires_at: datetime


def utc_now() -> datetime:
    return datetime.now(tz=UTC)


def hash_password(password: str) -> str:
    iterations = 120_000
    salt = urandom(16)
    digest = pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        algorithm, iteration_text, salt_hex, digest_hex = hashed_password.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iteration_text)
        salt = bytes.fromhex(salt_hex)
        expected_digest = bytes.fromhex(digest_hex)
    except ValueError:
        return False

    actual_digest = pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, iterations)
    return compare_digest(expected_digest, actual_digest)


def hash_refresh_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def _encode_token(payload: dict[str, str | int], expires_delta: timedelta) -> str:
    now = utc_now()
    claims = {
        **payload,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
    }
    return jwt.encode(claims, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(member_id: int) -> str:
    return _encode_token(
        {"sub": str(member_id), "type": "access", "jti": str(uuid4())},
        timedelta(minutes=settings.jwt_access_token_minutes),
    )


def create_refresh_token(member_id: int) -> RefreshTokenBundle:
    jti = str(uuid4())
    expires_at = utc_now() + timedelta(days=settings.jwt_refresh_token_days)
    token = _encode_token(
        {"sub": str(member_id), "type": "refresh", "jti": jti},
        timedelta(days=settings.jwt_refresh_token_days),
    )
    return RefreshTokenBundle(token=token, jti=jti, expires_at=expires_at)


def decode_token(raw_token: str, *, expected_type: str) -> dict[str, str | int]:
    try:
        payload = jwt.decode(
            raw_token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired.",
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token.",
        ) from exc

    token_type = payload.get("type")
    if token_type != expected_type:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token type: expected {expected_type}.",
        )

    if "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token subject is missing.",
        )
    return payload

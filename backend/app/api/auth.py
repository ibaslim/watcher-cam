from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db, session_scope
from app.models import User

router = APIRouter()

TOKEN_TTL_SECONDS = 60 * 30  # 30 minutes


class LoginIn(BaseModel):
    username: str
    password: str


class LoginOut(BaseModel):
    token: str
    auth_required: bool = True
    user: dict


def _secret() -> bytes:
    s = get_settings()
    base = s.dashboard_password or "camera-monitor-local-secret-change-me"
    return hashlib.sha256(base.encode()).digest()


def hash_password(password: str) -> str:
    salt = hashlib.sha256(str(time.time()).encode()).hexdigest()[:16]
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000)
    return f"pbkdf2_sha256${salt}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algo, salt, stored = password_hash.split("$", 2)
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000)
        return hmac.compare_digest(base64.urlsafe_b64encode(digest).decode(), stored)
    except Exception:
        return False


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def create_token(user: User) -> str:
    payload = {
        "sub": user.username,
        "uid": user.id,
        "role": user.role,
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def decode_token(token: str, *, allow_expired: bool = False) -> dict:
    try:
        body, sig = token.split(".", 1)
        expected = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())

        if not hmac.compare_digest(sig, expected):
            raise HTTPException(401, "invalid token")

        payload = json.loads(_unb64(body))

        if not allow_expired and int(payload.get("exp", 0)) < int(time.time()):
            raise HTTPException(401, "token expired")

        return payload

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "invalid token")


def user_view(user: User) -> dict:
    return {
        "id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "role": user.role,
        "is_active": user.is_active,
    }


def ensure_default_admin() -> None:
    with session_scope() as db:
        existing = db.scalar(select(User).where(User.username == "admin"))
        if existing:
            return

        admin = User(
            full_name="Administrator",
            username="admin",
            password_hash=hash_password("Admin@12345"),
            role="administrator",
            is_active=True,
        )
        db.add(admin)


def is_auth_required() -> bool:
    return True


@router.get("/status")
def status() -> dict:
    return {"auth_required": True}


@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn, db: Annotated[Session, Depends(get_db)]) -> LoginOut:
    username = payload.username.strip().lower()

    user = db.scalar(select(User).where(User.username == username))
    if not user or not user.is_active:
        raise HTTPException(401, "invalid username or password")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "invalid username or password")

    return LoginOut(token=create_token(user), user=user_view(user))


def _extract_token(request: Request, authorization: str | None) -> str:
    token = None

    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()

    if not token:
        token = request.query_params.get("token")

    if not token:
        raise HTTPException(401, "authentication required")

    return token


def get_current_user(
    db: Annotated[Session, Depends(get_db)],
    request: Request,
    authorization: str | None = Header(None),
) -> User:
    token = _extract_token(request, authorization)
    payload = decode_token(token)

    username = payload.get("sub")

    user = db.scalar(select(User).where(User.username == username))
    if not user or not user.is_active:
        raise HTTPException(401, "user inactive or not found")

    return user


async def require_auth(user: Annotated[User, Depends(get_current_user)]) -> None:
    return


def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != "administrator":
        raise HTTPException(403, "administrator access required")
    return user


def require_internal_service(
    request: Request,
    x_internal_token: str | None = Header(None),
) -> None:
    expected = get_settings().internal_service_token
    if not expected:
        return

    provided = x_internal_token or request.query_params.get("internal_token")
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(401, "invalid internal service token")


@router.get("/me")
def me(user: Annotated[User, Depends(get_current_user)]) -> dict:
    return user_view(user)


@router.post("/renew", response_model=LoginOut)
def renew(
    db: Annotated[Session, Depends(get_db)],
    request: Request,
    authorization: str | None = Header(None),
) -> LoginOut:
    token = _extract_token(request, authorization)
    payload = decode_token(token)

    username = payload.get("sub")

    user = db.scalar(select(User).where(User.username == username))
    if not user or not user.is_active:
        raise HTTPException(401, "user inactive or not found")

    return LoginOut(token=create_token(user), user=user_view(user))

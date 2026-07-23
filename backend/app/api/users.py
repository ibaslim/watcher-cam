from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import auth
from app.db import get_db
from app.models import User

router = APIRouter()


class UserCreate(BaseModel):
    full_name: str = ""
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6)
    role: str = Field(pattern="^(administrator|operator)$")


class UserUpdate(BaseModel):
    full_name: str = ""
    role: str = Field(pattern="^(administrator|operator)$")
    is_active: bool = True
    password: str = ""


def user_view(u: User) -> dict:
    return {
        "id": u.id,
        "full_name": u.full_name,
        "username": u.username,
        "role": u.role,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat() + "Z",
    }


@router.get("")
def list_users(
    _admin: Annotated[User, Depends(auth.require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> list[dict]:
    users = db.scalars(select(User).order_by(User.id.asc())).all()
    return [user_view(u) for u in users]


@router.post("", status_code=201)
def create_user(
    _admin: Annotated[User, Depends(auth.require_admin)],
    payload: UserCreate,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    username = payload.username.strip().lower()

    existing = db.scalar(select(User).where(User.username == username))
    if existing:
        raise HTTPException(409, "username already exists")

    u = User(
        full_name=payload.full_name.strip(),
        username=username,
        password_hash=auth.hash_password(payload.password),
        role=payload.role,
        is_active=True,
    )

    db.add(u)
    db.commit()
    db.refresh(u)

    return user_view(u)


@router.put("/{user_id}")
def update_user(
    user_id: int,
    payload: UserUpdate,
    _admin: Annotated[User, Depends(auth.require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "user not found")

    u.full_name = payload.full_name.strip()
    u.role = payload.role
    u.is_active = payload.is_active

    if payload.password.strip():
        u.password_hash = auth.hash_password(payload.password)

    db.commit()
    db.refresh(u)

    return user_view(u)


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    current: Annotated[User, Depends(auth.require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if current.id == user_id:
        raise HTTPException(400, "you cannot delete your own account")

    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "user not found")

    db.delete(u)
    db.commit()
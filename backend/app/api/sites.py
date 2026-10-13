from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import auth
from app.db import get_db
from app.models import Camera, Site, User

router = APIRouter()


class SiteIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    starred: bool = False

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter a site name")
        return value.strip()


def view(site: Site) -> dict:
    return {"id": site.id, "name": site.name, "starred": site.starred}


@router.get("")
def list_sites(db: Annotated[Session, Depends(get_db)]) -> list[dict]:
    return [view(site) for site in db.scalars(select(Site).order_by(Site.name)).all()]


@router.post("", status_code=201)
def create_site(payload: SiteIn, db: Annotated[Session, Depends(get_db)],
                _admin: Annotated[User, Depends(auth.require_admin)]) -> dict:
    site = Site(id=str(uuid4()), **payload.model_dump())
    db.add(site)
    db.commit()
    db.refresh(site)
    return view(site)


@router.put("/{site_id}")
def update_site(site_id: str, payload: SiteIn, db: Annotated[Session, Depends(get_db)],
                _admin: Annotated[User, Depends(auth.require_admin)]) -> dict:
    site = db.get(Site, site_id)
    if site is None:
        raise HTTPException(404, "site not found")
    site.name, site.starred = payload.name, payload.starred
    db.commit()
    db.refresh(site)
    return view(site)


@router.delete("/{site_id}", status_code=204)
def delete_site(site_id: str, db: Annotated[Session, Depends(get_db)],
                _admin: Annotated[User, Depends(auth.require_admin)]):
    site = db.get(Site, site_id)
    if site is None:
        raise HTTPException(404, "site not found")
    if db.scalar(select(Camera.id).where(Camera.site_id == site_id).limit(1)):
        raise HTTPException(409, "Move or delete this site's cameras before deleting the site")
    db.delete(site)
    db.commit()

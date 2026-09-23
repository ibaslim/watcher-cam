"""Site persistence, legacy migration, and camera assignment regression tests."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import Depends, HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app import db as database
from app.api import cameras, sites
from app.models import Base, Camera, Site


class SiteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_site_lifecycle_and_nonempty_delete(self):
        site = sites.create_site(sites.SiteIn(name="  Wapda Town Office  "), self.db, None)
        self.assertEqual(site["name"], "Wapda Town Office")
        updated = sites.update_site(site["id"], sites.SiteIn(name="Office", starred=True), self.db, None)
        self.assertTrue(updated["starred"])
        self.db.add(Camera(id="gate", name="Gate", site_id=site["id"]))
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            sites.delete_site(site["id"], self.db, None)
        self.assertEqual(error.exception.status_code, 409)
        self.assertIsNotNone(self.db.get(Camera, "gate"))
        self.db.delete(self.db.get(Camera, "gate"))
        self.db.commit()
        sites.delete_site(site["id"], self.db, None)
        self.assertEqual(sites.list_sites(self.db), [])

    def test_camera_creation_reassignment_and_invalid_site(self):
        first = sites.create_site(sites.SiteIn(name="Office"), self.db, None)
        second = sites.create_site(sites.SiteIn(name="Warehouse"), self.db, None)
        with patch.object(cameras.mediamtx, "sync_one", new=AsyncMock(return_value=None)), patch.object(cameras, "_notify_detector_refresh", new=AsyncMock()):
            result = asyncio.run(cameras.create_camera(None, cameras.CameraIn(id="gate", name="Gate", site_id=first["id"]), self.db))
            self.assertEqual(result["site_id"], first["id"])
            result = asyncio.run(cameras.update_camera(None, "gate", cameras.CameraUpdate(name="Gate", site_id=second["id"]), self.db))
            self.assertEqual(result["site_id"], second["id"])
            result = asyncio.run(cameras.update_camera(None, "gate", cameras.CameraUpdate(name="Gate"), self.db))
            self.assertEqual(result["site_id"], second["id"])
            with self.assertRaises(HTTPException):
                asyncio.run(cameras.create_camera(None, cameras.CameraIn(id="bad", name="Bad", site_id="missing"), self.db))
            self.assertIsNone(self.db.get(Camera, "bad"))
            with self.assertRaises(HTTPException):
                asyncio.run(cameras.update_camera(None, "gate", cameras.CameraUpdate(name="Gate", site_id="missing"), self.db))
            self.assertEqual(self.db.get(Camera, "gate").site_id, second["id"])

    def test_routes_require_admin_for_mutations(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app.api import auth
        from app.models import User

        app = FastAPI()
        app.include_router(sites.router, prefix="/sites", dependencies=[Depends(auth.get_current_user)])
        def operator():
            return User(id=1, username="operator", role="operator", is_active=True)
        app.dependency_overrides[auth.get_current_user] = operator
        app.dependency_overrides[database.get_db] = lambda: None
        with TestClient(app) as client:
            for method, path, body in [("POST", "/sites", {"name": "Office"}), ("PUT", "/sites/one", {"name": "Office"}), ("DELETE", "/sites/one", None)]:
                response = client.request(method, path, json=body)
                self.assertEqual(response.status_code, 403)

    def test_legacy_migration_is_repeatable_and_preserves_cameras(self):
        with self.engine.begin() as conn:
            conn.execute(text("DROP TABLE cameras"))
            conn.execute(text("CREATE TABLE cameras (id VARCHAR(64) PRIMARY KEY, name VARCHAR(128))"))
            conn.execute(text("INSERT INTO cameras VALUES ('old', 'Old camera')"))
        with patch.object(database, "engine", self.engine):
            database._apply_sqlite_additive_migrations()
            database._apply_sqlite_additive_migrations()
        with self.engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT name, site_id FROM cameras")).one(), ("Old camera", None))
        # Backfill operates on the full ORM schema after the additive migration.
        with self.engine.begin() as conn:
            conn.execute(text("DROP TABLE cameras"))
        Base.metadata.create_all(self.engine)
        self.db.add(Camera(id="legacy", name="Legacy", password="preserved"))
        self.db.commit()
        with patch.object(database, "SessionLocal", lambda: Session(self.engine)):
            database._backfill_camera_sites()
            database._backfill_camera_sites()
        self.db.expire_all()
        self.assertEqual(self.db.get(Camera, "legacy").site_id, "existing-cameras")
        self.assertEqual(self.db.get(Camera, "legacy").password, "preserved")
        self.assertEqual(self.db.query(Site).count(), 1)


if __name__ == "__main__":
    unittest.main()

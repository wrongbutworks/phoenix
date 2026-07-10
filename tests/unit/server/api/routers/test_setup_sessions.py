"""Route tests for the `px setup` device-auth-style session endpoints."""

import contextlib
import re
from datetime import datetime, timedelta, timezone
from secrets import token_hex
from typing import Any, AsyncIterator

import httpx
import pytest
from asgi_lifespan import LifespanManager
from pydantic import SecretStr
from sqlalchemy import select, update
from sqlalchemy.orm import joinedload
from strawberry.relay import GlobalID

from phoenix.auth import PHOENIX_ACCESS_TOKEN_COOKIE_NAME
from phoenix.db import models
from phoenix.server.app import create_app
from phoenix.server.bearer_auth import create_access_and_refresh_tokens
from phoenix.server.retention import TraceDataSweeper
from phoenix.server.types import DbSessionFactory
from tests.unit.conftest import TestBulkInserter, patch_batched_caller, patch_grpc_server

CREATE_PATH = "/auth/setup-sessions"
POLL_PATH = "/auth/setup-sessions/poll"
COMPLETE_PATH = "/auth/setup-sessions/complete"


@pytest.fixture
async def auth_client(
    db: DbSessionFactory,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[httpx.AsyncClient]:
    """An httpx client against an auth-enabled app."""
    monkeypatch.setenv("PHOENIX_DISABLE_RATE_LIMIT", "true")
    async with contextlib.AsyncExitStack() as stack:
        await stack.enter_async_context(patch_batched_caller())
        await stack.enter_async_context(patch_grpc_server())
        app = create_app(
            db=db,
            authentication_enabled=True,
            secret=SecretStr(token_hex(32)),
            serve_ui=False,
            bulk_inserter_factory=TestBulkInserter,
        )
        manager = await stack.enter_async_context(LifespanManager(app))
        transport = httpx.ASGITransport(app=manager.app)
        client = httpx.AsyncClient(transport=transport, base_url="http://test")
        client.__dict__["_app"] = app  # for token minting in helpers
        yield client


async def _login_cookie(
    client: httpx.AsyncClient,
    db: DbSessionFactory,
    *,
    role: str = "ADMIN",
) -> dict[str, str]:
    """Mint an access token for a user with the given role."""
    app = client.__dict__["_app"]
    async with db() as session:
        user = await session.scalar(
            select(models.User)
            .join(models.UserRole)
            .where(models.UserRole.name == role)
            .options(joinedload(models.User.role))
            .order_by(models.User.id)
            .limit(1)
        )
        if user is None:
            role_id = await session.scalar(
                select(models.UserRole.id).where(models.UserRole.name == role)
            )
            assert role_id is not None
            # OAUTH2 users don't require a password hash.
            user = models.User(
                email=f"{role.lower()}-{token_hex(4)}@localhost",
                username=f"{role.lower()}-{token_hex(4)}",
                user_role_id=role_id,
                reset_password=False,
                auth_method="OAUTH2",
                oauth2_user_id=token_hex(8),
            )
            session.add(user)
            await session.flush()
            user = await session.scalar(
                select(models.User)
                .where(models.User.id == user.id)
                .options(joinedload(models.User.role))
            )
            assert user is not None
    token_store = app.state.get_token_store()
    access_token, _ = await create_access_and_refresh_tokens(
        token_store=token_store,
        user=user,
        access_token_expiry=timedelta(hours=1),
        refresh_token_expiry=timedelta(hours=2),
    )
    return {PHOENIX_ACCESS_TOKEN_COOKIE_NAME: str(access_token)}


async def _create_project(db: DbSessionFactory, name: str = "wizard-test") -> str:
    async with db() as session:
        project = models.Project(name=name)
        session.add(project)
        await session.flush()
        return str(GlobalID("Project", str(project.id)))


def _poll_headers(poll_token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {poll_token}"}


async def _expire_session(db: DbSessionFactory, session_token_hash_prefix: Any = None) -> None:
    async with db() as session:
        await session.execute(
            update(models.SetupSession).values(
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)
            )
        )


class TestCreate:
    async def test_create_returns_tokens_and_stores_only_hashes(
        self, auth_client: httpx.AsyncClient, db: DbSessionFactory
    ) -> None:
        response = await auth_client.post(CREATE_PATH)
        assert response.status_code == 201
        body = response.json()
        assert re.fullmatch(
            r"[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}",
            body["verification_code"],
        )
        assert body["login_path"] == f"/cli-setup?session={body['session_token']}"
        async with db() as session:
            row = await session.scalar(select(models.SetupSession))
        assert row is not None
        assert row.status == "pending"
        assert body["session_token"] not in (row.session_token_hash, row.poll_token_hash)
        assert body["poll_token"] not in (row.session_token_hash, row.poll_token_hash)


class TestPoll:
    async def test_pending_then_unknown_and_bad_token(self, auth_client: httpx.AsyncClient) -> None:
        created = (await auth_client.post(CREATE_PATH)).json()
        response = await auth_client.get(
            POLL_PATH,
            params={"session_token": created["session_token"]},
            headers=_poll_headers(created["poll_token"]),
        )
        assert response.status_code == 200
        assert response.json() == {"status": "pending"}

        # Wrong poll token → 401
        response = await auth_client.get(
            POLL_PATH,
            params={"session_token": created["session_token"]},
            headers=_poll_headers("not-the-poll-token"),
        )
        assert response.status_code == 401

        # Unknown session → 404
        response = await auth_client.get(
            POLL_PATH,
            params={"session_token": "unknown"},
            headers=_poll_headers(created["poll_token"]),
        )
        assert response.status_code == 404

        # Missing Authorization header → 401
        response = await auth_client.get(
            POLL_PATH, params={"session_token": created["session_token"]}
        )
        assert response.status_code == 401

    async def test_expired_session_reports_expired(
        self, auth_client: httpx.AsyncClient, db: DbSessionFactory
    ) -> None:
        created = (await auth_client.post(CREATE_PATH)).json()
        await _expire_session(db)
        response = await auth_client.get(
            POLL_PATH,
            params={"session_token": created["session_token"]},
            headers=_poll_headers(created["poll_token"]),
        )
        assert response.status_code == 200
        assert response.json() == {"status": "expired"}


class TestComplete:
    async def test_full_flow_single_delivery(
        self, auth_client: httpx.AsyncClient, db: DbSessionFactory
    ) -> None:
        created = (await auth_client.post(CREATE_PATH)).json()
        project_gid = await _create_project(db)
        cookies = await _login_cookie(auth_client, db, role="ADMIN")

        response = await auth_client.post(
            COMPLETE_PATH,
            json={"session_token": created["session_token"], "project_id": project_gid},
            cookies=cookies,
        )
        assert response.status_code == 200, response.text

        # First poll delivers the key…
        response = await auth_client.get(
            POLL_PATH,
            params={"session_token": created["session_token"]},
            headers=_poll_headers(created["poll_token"]),
        )
        body = response.json()
        assert body["status"] == "complete"
        assert body["api_key"]
        assert body["project_id"] == project_gid
        assert body["project_name"] == "wizard-test"

        # …and the payload is scrubbed: a second poll sees "claimed".
        response = await auth_client.get(
            POLL_PATH,
            params={"session_token": created["session_token"]},
            headers=_poll_headers(created["poll_token"]),
        )
        assert response.json() == {"status": "claimed"}
        async with db() as session:
            row = await session.scalar(select(models.SetupSession))
        assert row is not None
        assert row.api_key_payload is None
        assert row.status == "claimed"

        # The minted key is a working bearer credential.
        response = await auth_client.get(
            "/v1/projects", headers={"authorization": f"Bearer {body['api_key']}"}
        )
        assert response.status_code == 200

    async def test_viewer_is_blocked(
        self, auth_client: httpx.AsyncClient, db: DbSessionFactory
    ) -> None:
        created = (await auth_client.post(CREATE_PATH)).json()
        project_gid = await _create_project(db, name="viewer-blocked")
        cookies = await _login_cookie(auth_client, db, role="VIEWER")
        response = await auth_client.post(
            COMPLETE_PATH,
            json={"session_token": created["session_token"], "project_id": project_gid},
            cookies=cookies,
        )
        assert response.status_code == 403

    async def test_unauthenticated_is_rejected(
        self, auth_client: httpx.AsyncClient, db: DbSessionFactory
    ) -> None:
        created = (await auth_client.post(CREATE_PATH)).json()
        project_gid = await _create_project(db, name="unauthed")
        response = await auth_client.post(
            COMPLETE_PATH,
            json={"session_token": created["session_token"], "project_id": project_gid},
        )
        assert response.status_code == 401

    async def test_expired_session_is_gone(
        self, auth_client: httpx.AsyncClient, db: DbSessionFactory
    ) -> None:
        created = (await auth_client.post(CREATE_PATH)).json()
        project_gid = await _create_project(db, name="expired-complete")
        cookies = await _login_cookie(auth_client, db, role="ADMIN")
        await _expire_session(db)
        response = await auth_client.post(
            COMPLETE_PATH,
            json={"session_token": created["session_token"], "project_id": project_gid},
            cookies=cookies,
        )
        assert response.status_code == 410


class TestSweep:
    async def test_sweeper_deletes_long_expired_sessions(
        self, auth_client: httpx.AsyncClient, db: DbSessionFactory
    ) -> None:
        await auth_client.post(CREATE_PATH)
        async with db() as session:
            await session.execute(
                update(models.SetupSession).values(
                    expires_at=datetime.now(timezone.utc) - timedelta(hours=2)
                )
            )
        sweeper = TraceDataSweeper.__new__(TraceDataSweeper)
        sweeper._db = db  # type: ignore[attr-defined]
        await sweeper._delete_expired_setup_sessions()
        async with db() as session:
            row = await session.scalar(select(models.SetupSession))
        assert row is None

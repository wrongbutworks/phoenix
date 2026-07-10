"""
Setup-session endpoints for `px setup` (the CLI onboarding wizard).

A device-authorization-style flow: the CLI creates a session and polls it;
the user signs in through the normal login wall at `/cli-setup`, picks a
project, and authorizes; the browser's authenticated `complete` call mints a
user API key which the poller receives exactly once.

Split-token design: `session_token` identifies the session (and appears in
the browser URL); `poll_token` authorizes polling and never leaves the
terminal; the browser holds the third credential (the user's session
cookie). A leaked login URL therefore cannot be used to poll for the key,
and a leaked poll token cannot complete the session.

These endpoints are mounted only when authentication is enabled (same
conditional as the `/auth` router).
"""

import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select, update
from strawberry.relay import GlobalID

from phoenix.config import get_env_disable_rate_limit
from phoenix.db import models
from phoenix.server.api.types.node import from_global_id_with_expected_type
from phoenix.server.bearer_auth import PhoenixUser, is_authenticated
from phoenix.server.rate_limiters import ServerRateLimiter, fastapi_ip_rate_limiter
from phoenix.server.types import ApiKeyAttributes, ApiKeyClaims, UserId

logger = logging.getLogger(__name__)

SESSION_LIFETIME = timedelta(minutes=15)

# No ambiguous glyphs (0/O, 1/I/L) — the user compares this code by eye.
_VERIFICATION_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

_create_rate_limiter = ServerRateLimiter(
    per_second_rate_limit=0.2,
    enforcement_window_seconds=60,
    partition_seconds=60,
    active_partitions=2,
)
# The CLI polls every 2 seconds; keep headroom above that.
_poll_rate_limiter = ServerRateLimiter(
    per_second_rate_limit=2,
    enforcement_window_seconds=30,
    partition_seconds=30,
    active_partitions=2,
)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _generate_verification_code() -> str:
    chars = [secrets.choice(_VERIFICATION_CODE_ALPHABET) for _ in range(8)]
    return f"{''.join(chars[:4])}-{''.join(chars[4:])}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CreateSetupSessionResponseBody(BaseModel):
    session_token: str
    poll_token: str
    expires_at: datetime
    login_path: str
    verification_code: str


async def _create_setup_session(request: Request) -> Any:
    session_token = secrets.token_urlsafe(16)
    poll_token = secrets.token_urlsafe(16)
    verification_code = _generate_verification_code()
    expires_at = _now() + SESSION_LIFETIME
    async with request.app.state.db() as session:
        session.add(
            models.SetupSession(
                session_token_hash=_hash_token(session_token),
                poll_token_hash=_hash_token(poll_token),
                verification_code=verification_code,
                status="pending",
                expires_at=expires_at,
            )
        )
        await session.commit()
    return CreateSetupSessionResponseBody(
        session_token=session_token,
        poll_token=poll_token,
        expires_at=expires_at,
        login_path=f"/cli-setup?session={session_token}",
        verification_code=verification_code,
    )


def _poll_token_from_header(request: Request) -> str:
    authorization = request.headers.get("authorization") or ""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Missing poll token")
    return token.strip()


async def _poll_setup_session(
    request: Request,
    session_token: str = Query(...),
) -> dict[str, Any]:
    poll_token = _poll_token_from_header(request)
    async with request.app.state.db() as db:
        setup_session = await db.scalar(
            select(models.SetupSession).where(
                models.SetupSession.session_token_hash == _hash_token(session_token)
            )
        )
        if setup_session is None:
            raise HTTPException(status_code=404, detail="Unknown session")
        if not hmac.compare_digest(
            setup_session.poll_token_hash,
            _hash_token(poll_token),
        ):
            raise HTTPException(status_code=401, detail="Invalid poll token")

        if setup_session.status == "pending":
            if setup_session.expires_at <= _now():
                setup_session.status = "expired"
                setup_session.api_key_payload = None
                await db.commit()
                return {"status": "expired"}
            return {"status": "pending"}

        if setup_session.status == "complete":
            payload_blob = setup_session.api_key_payload
            # Atomic transition: exactly one poller can move the row from
            # complete → claimed; everyone else observes claimed.
            result = await db.execute(
                update(models.SetupSession)
                .where(
                    models.SetupSession.id == setup_session.id,
                    models.SetupSession.status == "complete",
                )
                .values(
                    status="claimed",
                    api_key_payload=None,
                    delivered_at=_now(),
                )
            )
            await db.commit()
            if result.rowcount == 1 and payload_blob is not None:
                payload = json.loads(request.app.state.decrypt(payload_blob).decode("utf-8"))
                return {
                    "status": "complete",
                    "api_key": payload["api_key"],
                    "project_id": payload["project_id"],
                    "project_name": payload["project_name"],
                }
            return {"status": "claimed"}

        # "claimed" or "expired"
        return {"status": setup_session.status}


class CompleteSetupSessionRequestBody(BaseModel):
    session_token: str
    project_id: str


async def _complete_setup_session(
    request: Request,
    body: CompleteSetupSessionRequestBody,
) -> dict[str, Any]:
    user = request.user
    assert isinstance(user, PhoenixUser)
    if user.is_viewer:
        raise HTTPException(
            status_code=403,
            detail=(
                "Your role can't send traces — ask an admin to upgrade your role or run setup."
            ),
        )

    try:
        project_rowid = from_global_id_with_expected_type(
            GlobalID.from_id(body.project_id), "Project"
        )
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid project id")

    token_store = request.app.state.get_token_store()

    # Validate the session and project, then close the db session before
    # minting: `create_api_key` opens its own db session internally, and
    # nesting the two can deadlock on single-connection pools.
    async with request.app.state.db() as db:
        setup_session = await db.scalar(
            select(models.SetupSession).where(
                models.SetupSession.session_token_hash == _hash_token(body.session_token)
            )
        )
        if setup_session is None:
            raise HTTPException(status_code=404, detail="Unknown session")
        if setup_session.status != "pending" or setup_session.expires_at <= _now():
            raise HTTPException(status_code=410, detail="Session expired or already used")
        project = await db.scalar(select(models.Project).where(models.Project.id == project_rowid))
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        setup_session_id = setup_session.id
        project_name = project.name

    issued_at = _now()
    user_role: Literal["ADMIN", "MEMBER"] = "ADMIN" if user.is_admin else "MEMBER"
    claims = ApiKeyClaims(
        subject=UserId(int(user.identity)),
        issued_at=issued_at,
        # No expiry: the production hand-off step tells users to put
        # this key in their secret store; it is revocable in settings.
        expiration_time=None,
        attributes=ApiKeyAttributes(
            user_role=user_role,
            name=f"cli-setup {issued_at.date().isoformat()}",
            description="Created by `px setup`",
        ),
    )
    api_key, _ = await token_store.create_api_key(claims)

    payload = json.dumps(
        {
            "api_key": api_key,
            "project_id": str(GlobalID("Project", str(project_rowid))),
            "project_name": project_name,
        }
    ).encode("utf-8")

    async with request.app.state.db() as db:
        # Atomic pending → complete: a concurrent complete loses the race
        # and sees 410. (Its freshly minted key stays revocable in settings.)
        result = await db.execute(
            update(models.SetupSession)
            .where(
                models.SetupSession.id == setup_session_id,
                models.SetupSession.status == "pending",
            )
            .values(
                status="complete",
                user_id=int(user.identity),
                project_id=project_rowid,
                api_key_payload=request.app.state.encrypt(payload),
            )
        )
        await db.commit()
    if result.rowcount != 1:
        raise HTTPException(status_code=410, detail="Session expired or already used")

    return {"status": "ok"}


async def _get_setup_session_info(
    request: Request,
    session_token: str = Query(...),
) -> dict[str, Any]:
    """Claim-page bootstrap: verification code + liveness for a session.

    Requires an authenticated browser user (the code is not secret, but
    there is no reason to serve it anonymously).
    """
    async with request.app.state.db() as db:
        setup_session = await db.scalar(
            select(models.SetupSession).where(
                models.SetupSession.session_token_hash == _hash_token(session_token)
            )
        )
    if setup_session is None:
        raise HTTPException(status_code=404, detail="Unknown session")
    status: str = setup_session.status
    if status == "pending" and setup_session.expires_at <= _now():
        status = "expired"
    user = request.user
    viewer_blocked = isinstance(user, PhoenixUser) and user.is_viewer
    return {
        "status": status,
        "verification_code": setup_session.verification_code,
        "expires_at": setup_session.expires_at.isoformat(),
        # Viewer keys can't ingest traces over HTTP OTLP — the claim page
        # shows the role-block message instead of the project picker.
        "viewer_blocked": viewer_blocked,
    }


def create_setup_sessions_router() -> APIRouter:
    """Create the setup-sessions router (auth-enabled deployments only)."""
    rate_limit_disabled = get_env_disable_rate_limit()
    create_dependencies = (
        [] if rate_limit_disabled else [Depends(fastapi_ip_rate_limiter(_create_rate_limiter))]
    )
    poll_dependencies = (
        [] if rate_limit_disabled else [Depends(fastapi_ip_rate_limiter(_poll_rate_limiter))]
    )

    router = APIRouter(prefix="/auth/setup-sessions", include_in_schema=False)
    router.add_api_route(
        "",
        _create_setup_session,
        methods=["POST"],
        status_code=201,
        dependencies=create_dependencies,
    )
    router.add_api_route(
        "/poll",
        _poll_setup_session,
        methods=["GET"],
        dependencies=poll_dependencies,
    )
    router.add_api_route(
        "/complete",
        _complete_setup_session,
        methods=["POST"],
        dependencies=[Depends(is_authenticated), *create_dependencies],
    )
    router.add_api_route(
        "/info",
        _get_setup_session_info,
        methods=["GET"],
        dependencies=[Depends(is_authenticated)],
    )
    return router

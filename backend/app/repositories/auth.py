"""Persistence for authentication (Phase 11B): users-by-email, sessions, tokens, events, roles,
rate-limit counters and retention queries.

Queries and ``add``/``update``/``flush`` only — **never commits** (BACKEND_ARCHITECTURE.md §5). The
auth services own every transaction. Guarded ``UPDATE ... RETURNING`` statements are used wherever
a race matters (single-use tokens, rate-limit counters).
"""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import CursorResult, and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import (
    AuthEvent,
    AuthIdentity,
    AuthRateLimit,
    AuthSession,
    AuthToken,
    OAuthFlow,
    ProfessionalProfile,
    User,
    UserRole,
)
from app.models.enums import (
    AuthProvider,
    AuthTokenPurpose,
    PlanCode,
    RoleName,
    SessionRevokeReason,
)


class UserAuthRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_email(self, email: str) -> User | None:
        """The account whose normalized email is ``email`` (served by ``uq_users_email_lower``)."""
        return self._session.scalars(select(User).where(func.lower(User.email) == email)).first()

    def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return self._session.get(User, user_id)

    def lock(self, user_id: uuid.UUID) -> User | None:
        """``SELECT ... FOR UPDATE`` — serializes concurrent session/role changes for one user."""
        return self._session.scalars(
            select(User).where(User.id == user_id).with_for_update()
        ).one_or_none()

    def lock_by_email(self, email: str) -> User | None:
        return self._session.scalars(
            select(User).where(func.lower(User.email) == email).with_for_update()
        ).first()

    def add(self, user: User) -> None:
        self._session.add(user)
        self._session.flush()

    def provider_names(self, user_id: uuid.UUID) -> list[str]:
        rows = self._session.scalars(
            select(AuthIdentity.provider)
            .where(AuthIdentity.user_id == user_id)
            .order_by(AuthIdentity.provider)
        )
        return [provider.value for provider in rows]


class SessionRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, auth_session: AuthSession) -> None:
        self._session.add(auth_session)
        self._session.flush()

    def get_with_account(
        self, token_hash: bytes
    ) -> tuple[AuthSession, User, PlanCode | None, list[RoleName]] | None:
        """The session, its user, the professional plan (if any) and the explicit roles."""
        row = self._session.execute(
            select(AuthSession, User, ProfessionalProfile.plan_code)
            .join(User, User.id == AuthSession.user_id)
            .outerjoin(ProfessionalProfile, ProfessionalProfile.user_id == User.id)
            .where(AuthSession.token_hash == token_hash)
        ).one_or_none()
        if row is None:
            return None
        auth_session, user, plan = row
        roles = list(
            self._session.scalars(select(UserRole.role).where(UserRole.user_id == user.id))
        )
        return auth_session, user, plan, roles

    def roles_and_plan(self, user_id: uuid.UUID) -> tuple[list[RoleName], PlanCode | None]:
        roles = list(
            self._session.scalars(select(UserRole.role).where(UserRole.user_id == user_id))
        )
        plan = self._session.scalars(
            select(ProfessionalProfile.plan_code).where(ProfessionalProfile.user_id == user_id)
        ).one_or_none()
        return roles, plan

    def active_for_user(self, user_id: uuid.UUID, now: datetime) -> list[AuthSession]:
        """Active sessions, oldest first. Ties on ``created_at`` break on ``id`` (deterministic)."""
        return list(
            self._session.scalars(
                select(AuthSession)
                .where(
                    AuthSession.user_id == user_id,
                    AuthSession.revoked_at.is_(None),
                    AuthSession.expires_at > now,
                    AuthSession.absolute_expires_at > now,
                )
                .order_by(AuthSession.created_at, AuthSession.id)
            )
        )

    def revoke(
        self, session_ids: Sequence[uuid.UUID], reason: SessionRevokeReason, now: datetime
    ) -> None:
        if not session_ids:
            return
        self._session.execute(
            update(AuthSession)
            .where(AuthSession.id.in_(session_ids), AuthSession.revoked_at.is_(None))
            .values(revoked_at=now, revoke_reason=reason)
        )

    def revoke_all_for_user(
        self,
        user_id: uuid.UUID,
        reason: SessionRevokeReason,
        now: datetime,
        *,
        except_session_id: uuid.UUID | None = None,
    ) -> list[uuid.UUID]:
        """Revoke every not-yet-revoked session of the user; returns the ids that were revoked."""
        condition = [AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)]
        if except_session_id is not None:
            condition.append(AuthSession.id != except_session_id)
        rows = self._session.execute(
            update(AuthSession)
            .where(*condition)
            .values(revoked_at=now, revoke_reason=reason)
            .returning(AuthSession.id)
        )
        return [row[0] for row in rows]

    def touch(self, session_id: uuid.UUID, last_seen_at: datetime, expires_at: datetime) -> None:
        self._session.execute(
            update(AuthSession)
            .where(AuthSession.id == session_id)
            .values(last_seen_at=last_seen_at, expires_at=expires_at)
        )

    def rotate(
        self,
        session_id: uuid.UUID,
        new_token_hash: bytes,
        last_seen_at: datetime,
        expires_at: datetime,
    ) -> None:
        self._session.execute(
            update(AuthSession)
            .where(AuthSession.id == session_id)
            .values(token_hash=new_token_hash, last_seen_at=last_seen_at, expires_at=expires_at)
        )

    def delete_expired_for_user(self, user_id: uuid.UUID, now: datetime) -> None:
        """Opportunistic cleanup at login: this user's already-expired sessions."""
        self._session.execute(
            delete(AuthSession).where(
                AuthSession.user_id == user_id,
                or_(AuthSession.expires_at < now, AuthSession.absolute_expires_at < now),
            )
        )


class TokenRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, token: AuthToken) -> None:
        self._session.add(token)
        self._session.flush()

    def invalidate_unconsumed(
        self,
        user_id: uuid.UUID,
        purposes: Sequence[AuthTokenPurpose],
        now: datetime,
    ) -> int:
        """Mark the user's outstanding tokens of these purposes consumed (replaced/superseded)."""
        result = self._session.execute(
            update(AuthToken)
            .where(
                AuthToken.user_id == user_id,
                AuthToken.purpose.in_(purposes),
                AuthToken.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        assert isinstance(result, CursorResult)
        return result.rowcount

    def lock_by_hash(self, token_hash: bytes) -> AuthToken | None:
        """The token row, locked so a concurrent redemption waits for this transaction."""
        return self._session.scalars(
            select(AuthToken).where(AuthToken.token_hash == token_hash).with_for_update()
        ).one_or_none()

    def consume(self, token_hash: bytes, purpose: AuthTokenPurpose, now: datetime) -> bool:
        """Atomic single-use redemption: exactly one concurrent caller can get ``True``."""
        row = self._session.execute(
            update(AuthToken)
            .where(
                AuthToken.token_hash == token_hash,
                AuthToken.purpose == purpose,
                AuthToken.consumed_at.is_(None),
                AuthToken.expires_at > now,
            )
            .values(consumed_at=now)
            .returning(AuthToken.id)
        ).first()
        return row is not None


class EventRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, event: AuthEvent) -> None:
        self._session.add(event)
        self._session.flush()


class RoleRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def has(self, user_id: uuid.UUID, role: RoleName) -> bool:
        return self._session.get(UserRole, (user_id, role)) is not None

    def grant(
        self, user_id: uuid.UUID, role: RoleName, granted_by: uuid.UUID | None, now: datetime
    ) -> bool:
        """Insert the grant if absent (no duplicate rows). Returns whether a row was inserted."""
        row = self._session.execute(
            pg_insert(UserRole)
            .values(user_id=user_id, role=role, granted_by=granted_by, granted_at=now)
            .on_conflict_do_nothing(index_elements=["user_id", "role"])
            .returning(UserRole.user_id)
        ).first()
        return row is not None

    def revoke(self, user_id: uuid.UUID, role: RoleName) -> bool:
        result = self._session.execute(
            delete(UserRole).where(UserRole.user_id == user_id, UserRole.role == role)
        )
        assert isinstance(result, CursorResult)
        return result.rowcount > 0


class RateLimitRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def increment(self, key_hash: bytes, policy: str, window_start: datetime) -> int:
        """Atomically add one to the window's counter and return the new count."""
        count = self._session.execute(
            pg_insert(AuthRateLimit)
            .values(key_hash=key_hash, policy=policy, window_start=window_start, count=1)
            .on_conflict_do_update(
                index_elements=["key_hash", "policy", "window_start"],
                set_={"count": AuthRateLimit.count + 1},
            )
            .returning(AuthRateLimit.count)
        ).scalar_one()
        return int(count)

    def current(self, key_hash: bytes, policy: str, window_start: datetime) -> int:
        count = self._session.scalars(
            select(AuthRateLimit.count).where(
                AuthRateLimit.key_hash == key_hash,
                AuthRateLimit.policy == policy,
                AuthRateLimit.window_start == window_start,
            )
        ).one_or_none()
        return int(count or 0)


class IdentityRepository:
    """Social identities (``auth_identities``). The key is ``(provider, provider_subject)``."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_subject(self, provider: AuthProvider, subject: str) -> AuthIdentity | None:
        return self._session.scalars(
            select(AuthIdentity).where(
                AuthIdentity.provider == provider, AuthIdentity.provider_subject == subject
            )
        ).one_or_none()

    def get_for_user(self, user_id: uuid.UUID, provider: AuthProvider) -> AuthIdentity | None:
        return self._session.scalars(
            select(AuthIdentity).where(
                AuthIdentity.user_id == user_id, AuthIdentity.provider == provider
            )
        ).one_or_none()

    def count_for_user(self, user_id: uuid.UUID) -> int:
        return int(
            self._session.scalar(
                select(func.count())
                .select_from(AuthIdentity)
                .where(AuthIdentity.user_id == user_id)
            )
            or 0
        )

    def add(self, identity: AuthIdentity) -> None:
        self._session.add(identity)
        self._session.flush()

    def delete(self, identity: AuthIdentity) -> None:
        self._session.delete(identity)
        self._session.flush()


class OAuthFlowRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, flow: OAuthFlow) -> None:
        self._session.add(flow)
        self._session.flush()

    def consume(
        self,
        *,
        state_hash: bytes,
        flow_cookie_hash: bytes,
        provider: AuthProvider,
        now: datetime,
    ) -> OAuthFlow | None:
        """Atomic single use. One guarded ``UPDATE ... RETURNING`` that requires the state, the
        browser-binding cookie, the provider and an unexpired, unconsumed row: of any number of
        concurrent or replayed callbacks, at most one gets the row back."""
        return self._session.execute(
            update(OAuthFlow)
            .where(
                OAuthFlow.state_hash == state_hash,
                OAuthFlow.flow_cookie_hash == flow_cookie_hash,
                OAuthFlow.provider == provider,
                OAuthFlow.consumed_at.is_(None),
                OAuthFlow.expires_at > now,
            )
            .values(consumed_at=now)
            .returning(OAuthFlow)
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()


class AuthMaintenanceRepository:
    """Sweep deletes (``python -m app.cli.auth_maintenance purge``; not a retention promise)."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def _delete(self, statement: object) -> int:
        result = self._session.execute(statement)  # type: ignore[call-overload]
        assert isinstance(result, CursorResult)
        return result.rowcount

    def purge_sessions(self, cutoff: datetime) -> int:
        """Sessions that expired, or were revoked, before ``cutoff``."""
        return self._delete(
            delete(AuthSession).where(
                or_(
                    AuthSession.expires_at < cutoff,
                    AuthSession.absolute_expires_at < cutoff,
                    and_(AuthSession.revoked_at.is_not(None), AuthSession.revoked_at < cutoff),
                )
            )
        )

    def purge_tokens(self, cutoff: datetime) -> int:
        """Tokens that expired, or were consumed, before ``cutoff``."""
        return self._delete(
            delete(AuthToken).where(
                or_(
                    AuthToken.expires_at < cutoff,
                    and_(AuthToken.consumed_at.is_not(None), AuthToken.consumed_at < cutoff),
                )
            )
        )

    def purge_rate_limits(self, cutoff: datetime) -> int:
        return self._delete(delete(AuthRateLimit).where(AuthRateLimit.window_start < cutoff))

    def purge_oauth_flows(self, cutoff: datetime) -> int:
        """Flows (consumed or not) that expired before ``cutoff``."""
        return self._delete(delete(OAuthFlow).where(OAuthFlow.expires_at < cutoff))

    def purge_events(self, cutoff: datetime) -> int:
        return self._delete(delete(AuthEvent).where(AuthEvent.occurred_at < cutoff))

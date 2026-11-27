"""The Grocery operating settings, Super Admin only (GROCERY-1b; docs/backend/AUTH_RBAC.md §33).

A change is ONE transaction: the actor and acting session, then the ``admin`` role, re-read and
locked (a demotion, reset or sign-out that committed is seen; one that has not waits) → the
exclusive settings lock (submissions hold it shared, so a change waits for those in flight and later
ones see it) → the revision check → a COMPLETE new row. Nothing is ever updated: the table is the
record of who set what, and when.

The Grocery staff scope grants nothing here. Settings authority is the Super Admin role.
"""

import datetime

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.errors import AppError, ErrorCode, ErrorDetail
from app.core.logging import request_id_var
from app.db.session import transaction
from app.models import GrocerySettingsRevision
from app.models.enums import RoleName
from app.repositories.grocery import GroceryRepository
from app.repositories.staff import StaffAuthorityRepository
from app.schemas.grocery import GrocerySettingsActor, GrocerySettingsPatch, GrocerySettingsRead
from app.services.auth_sessions import Principal, hold_acting_session
from app.services.grocery_errors import private_database_errors
from app.services.grocery_orders import clock_text

#: Every setting, in the model's names. A new version copies all of them.
SETTING_FIELDS: tuple[str, ...] = (
    "enabled",
    "serviceable_blocks",
    "operating_days",
    "opens_at",
    "closes_at",
    "timezone",
    "daily_capacity",
    "max_active_orders_per_customer",
    "max_items_per_order",
)
_TIME_FIELDS = ("opens_at", "closes_at")
_MAX_REQUEST_ID = 64


def _unavailable() -> AppError:
    return AppError(ErrorCode.GROCERY_UNAVAILABLE, status_code=503)


class GrocerySettingsService:
    def __init__(self, session: Session, *, clock: Clock) -> None:
        self._session = session
        self._clock = clock
        self._repository = GroceryRepository(session)
        self._authority = StaffAuthorityRepository(session)

    def read(self) -> GrocerySettingsRead:
        current = self._repository.current_settings()
        if current is None:
            raise _unavailable()
        return self._present(current)

    def update(self, principal: Principal, patch: GrocerySettingsPatch) -> GrocerySettingsRead:
        """Order of refusal: not a Super Admin NOW (``403``) → an ended session (``401``) → a
        stale ``revision`` (``409``) →
        nothing given, or closing not after opening (``422``). A change equal to the current
        settings writes nothing."""
        actor_id = principal.user_id
        with private_database_errors(), transaction(self._session):
            acting = hold_acting_session(
                self._authority, actor_id, principal.session_id, self._clock
            )
            if RoleName.ADMIN not in self._authority.share_staff_roles(actor_id):
                raise AppError(ErrorCode.FORBIDDEN, status_code=403)
            acting.require()
            self._repository.lock_settings_exclusive()
            current = self._repository.current_settings()
            if current is None:
                raise _unavailable()
            if patch.revision != current.revision:
                raise AppError(
                    ErrorCode.CONFLICT,
                    status_code=409,
                    details=[
                        ErrorDetail(
                            field="revision",
                            code="stale_revision",
                            message=f"The settings are now at revision {current.revision}.",
                        )
                    ],
                )
            given = patch.model_fields_set - {"revision"}
            if not given:
                raise AppError(
                    ErrorCode.VALIDATION_ERROR,
                    status_code=422,
                    details=[
                        ErrorDetail(
                            field="body", code="no_changes", message="Give a setting to change."
                        )
                    ],
                )
            values = {name: getattr(current, name) for name in SETTING_FIELDS}
            for name in given:
                value = getattr(patch, name)
                if name in _TIME_FIELDS:
                    value = datetime.time.fromisoformat(value)
                values[name] = value
            if values["opens_at"] >= values["closes_at"]:
                raise AppError(
                    ErrorCode.VALIDATION_ERROR,
                    status_code=422,
                    details=[
                        ErrorDetail(
                            field="closesAt",
                            code="closes_before_opens",
                            message="The closing time must be after the opening time.",
                        )
                    ],
                )
            if all(values[name] == getattr(current, name) for name in SETTING_FIELDS):
                return self._present(current)
            request_id = request_id_var.get()
            saved = self._repository.add_settings(
                GrocerySettingsRevision(
                    revision=current.revision + 1,
                    actor_user_id=actor_id,
                    request_id=request_id[:_MAX_REQUEST_ID] if request_id else None,
                    **values,
                )
            )
            self._session.refresh(saved)  # created_at is the database's
            return self._present(saved)

    def _present(self, row: GrocerySettingsRevision) -> GrocerySettingsRead:
        return GrocerySettingsRead(
            revision=row.revision,
            enabled=row.enabled,
            serviceable_blocks=list(row.serviceable_blocks),
            operating_days=list(row.operating_days),
            opens_at=clock_text(row.opens_at),
            closes_at=clock_text(row.closes_at),
            timezone=row.timezone,
            daily_capacity=row.daily_capacity,
            max_active_orders_per_customer=row.max_active_orders_per_customer,
            max_items_per_order=row.max_items_per_order,
            updated_at=row.created_at,
            updated_by=(
                GrocerySettingsActor(
                    user_id=row.actor_user_id,
                    display_name=self._repository.display_name(row.actor_user_id),
                )
                if row.actor_user_id is not None
                else None
            ),
        )

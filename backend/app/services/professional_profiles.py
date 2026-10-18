"""The Professional profile: the capability that lets a verified user list (Phase 12D).

Professional is a *capability* (a ``professional_profiles`` row), never a role (AUTH_RBAC.md §3).
The only write is the idempotent ``PUT /users/me/professional-profile``: there is no client-writable
field (the plan is server-owned — ``free`` — and billing is out of scope), so "create or update"
reduces to "ensure it exists". One atomic ``INSERT … ON CONFLICT DO NOTHING`` makes concurrent first
calls leave exactly one row, and exactly one caller sees the creation.
"""

import uuid

from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.db.session import transaction
from app.models.enums import PlanCode
from app.repositories.owner_listings import ProfessionalProfileRepository


class ProfessionalProfileService:
    def __init__(self, session: Session) -> None:
        self._profiles = ProfessionalProfileRepository(session)
        self._session = session

    def ensure(self, user_id: uuid.UUID) -> tuple[PlanCode, bool]:
        """The user's plan and whether THIS call created the profile."""
        with transaction(self._session):
            created = self._profiles.insert_if_absent(user_id)
        plan = self._profiles.plan_of(user_id)
        if plan is None:  # pragma: no cover - the row was just inserted or already existed
            raise AppError(ErrorCode.INTERNAL_ERROR, status_code=500)
        return plan, created

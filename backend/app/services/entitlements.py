"""Plan entitlements enforced by the backend (docs/backend/API_CONTRACT.md §10.9).

A code-level map that mirrors the frontend's ``config/plans.ts``; the backend is authoritative, the
frontend copy only shapes the UI. Plan *changes* are not part of Phase 12 (no billing), so the plan
of a professional profile is always the server-owned default.
"""

from app.models.enums import PlanCode

#: Active = ``pending`` + ``approved``. ``None`` means unlimited.
MAX_ACTIVE_LISTINGS: dict[PlanCode, int | None] = {
    PlanCode.FREE: 3,
    PlanCode.PREMIUM: None,
}


def max_active_listings(plan: PlanCode) -> int | None:
    return MAX_ACTIVE_LISTINGS[plan]

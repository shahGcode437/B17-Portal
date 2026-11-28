"""Staff-management schemas (RBAC-C; docs/backend/AUTH_RBAC.md §27.7, §27.11).

Requests are STRICT (``StrictRequest``): an undeclared key — ``role``, ``staffScopes``, ``userId``,
``grantedBy`` — is rejected, never ignored, so authority can only come from the declared fields and
the backend's own checks. Responses are explicit field lists: a password hash, a session value, a
token, an OAuth subject or any unrelated private account data has no field to travel in.
"""

import datetime
import uuid
from typing import Annotated, Any

from pydantic import AwareDatetime, Field, StringConstraints, model_validator

from app.models.enums import (
    RoleName,
    StaffAuditAction,
    StaffAuditResource,
    StaffAuditSource,
    StaffScope,
    UserStatus,
)
from app.schemas.envelope import ApiModel, PageMeta
from app.schemas.write import StrictRequest

#: At most one entry per staff scope. NOT ``min_length=1``: an empty list reaches the service so
#: the answer is the explicit ``invalid_staff_scope`` ("pause the moderator instead"), not a generic
#: validation error.
Scopes = Annotated[list[StaffScope], Field(max_length=len(StaffScope))]

#: The ``staff_revision`` a change was decided on (AUTH_RBAC.md §39). REQUIRED on every change: an
#: optional one would let a client that leaves it out overwrite another administrator's change.
StaffRevision = Annotated[int, Field(ge=0, le=2_147_483_647, strict=True)]

# ------------------------------------------------------------------------------ requests


class AppointModeratorRequest(StrictRequest):
    #: The address of an EXISTING account. Not format-validated here: a malformed address must be
    #: indistinguishable from an unknown one (the answer is ``target_not_eligible`` for both).
    email: Annotated[str, StringConstraints(max_length=320)]
    scopes: Scopes
    #: 0 for an account that has never held a staff role.
    revision: StaffRevision


class ReplaceScopesRequest(StrictRequest):
    """Replace-set semantics: the Moderator ends up with EXACTLY these scopes. An empty set is a
    pause, which is a separate operation, and is refused here."""

    scopes: Scopes
    revision: StaffRevision


class ResumeModeratorRequest(StrictRequest):
    scopes: Scopes
    revision: StaffRevision


class PauseModeratorRequest(StrictRequest):
    revision: StaffRevision


class StaffRosterQuery(ApiModel):
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=10_000)


class StaffAuditQuery(ApiModel):
    """Every filter is optional and ANDs with the others. Single-word names on purpose (plain query
    keys, no alias questions). ``limit`` is bounded, so no request is an unbounded scan."""

    action: StaffAuditAction | None = None
    actor: uuid.UUID | None = None
    target: uuid.UUID | None = None
    resource: StaffAuditResource | None = None
    since: AwareDatetime | None = None
    until: AwareDatetime | None = None
    limit: int = Field(default=25, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=100_000)

    @model_validator(mode="before")
    @classmethod
    def _blank_is_absent(cls, values: object) -> object:
        if isinstance(values, dict):
            return {key: (None if value == "" else value) for key, value in values.items()}
        return values


# ------------------------------------------------------------------------------ responses


class StaffGrantor(ApiModel):
    """Who granted the role: a display name only (``None`` entirely for an operator CLI grant)."""

    user_id: uuid.UUID
    display_name: str


class StaffMember(ApiModel):
    user_id: uuid.UUID
    display_name: str
    email: str
    #: The stored role value: ``admin`` is a Super Admin (read-only here), ``moderator`` a
    #: Moderator.
    role: RoleName
    #: A Moderator's active scopes, sorted; always empty for a Super Admin.
    scopes: list[StaffScope]
    #: A Moderator with no scopes: keeps the role, has no authority. Always ``false`` for admins.
    paused: bool
    account_status: UserStatus
    email_verified: bool
    granted_at: datetime.datetime
    granted_by: StaffGrantor | None = None
    #: State this with the next change to this account (§39).
    revision: int


class StaffMemberEnvelope(ApiModel):
    data: StaffMember


class StaffRosterEnvelope(ApiModel):
    data: list[StaffMember]
    meta: PageMeta


class StaffPerson(ApiModel):
    """An actor or target of an audit event. ``display_name`` is ``None`` when the account no
    longer exists (the audit keeps the identifier; it has no foreign keys)."""

    user_id: uuid.UUID
    display_name: str | None = None


class StaffAuditEntry(ApiModel):
    id: uuid.UUID
    occurred_at: datetime.datetime
    source: StaffAuditSource
    action: StaffAuditAction
    #: ``None`` for an operator CLI action.
    actor: StaffPerson | None = None
    target: StaffPerson | None = None
    resource_type: StaffAuditResource | None = None
    resource_id: uuid.UUID | None = None
    #: The allow-listed state payloads exactly as stored (scalars and short lists only; the writer
    #: refuses a secret-looking key, so there is none to return).
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    reason: str | None = None
    request_id: str | None = None


class StaffAuditEnvelope(ApiModel):
    data: list[StaffAuditEntry]
    meta: PageMeta

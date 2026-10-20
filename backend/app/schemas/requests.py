"""Service-request schemas (Phase 12F; docs/backend/API_CONTRACT.md §10.8, §13).

The create body is strict like every write: a key it does not declare — ``requesterId``,
``providerId``, ``ownerId``, ``status``, ``createdAt``, ``requestedBy``, ``providerName`` … — is
``422 not_allowed``. The requester is always the session user; the provider is always derived from
the target listing's owner; the status always starts ``submitted``.

Three explicit response shapes, none of which reuses an owner / admin listing mapper:

* ``ServiceRequestSummary`` — what the REQUESTER sees in "my requests";
* ``LeadSummary`` — what the PROVIDER sees in the inbox (adds the requester's display name);
* ``ServiceRequestDetail`` — either party's view of one request (adds the status history).

None carries an e-mail, a phone number, a user id, a role list or any session / auth data.
"""

import datetime
import re
import uuid
from typing import Annotated

from pydantic import Field, StringConstraints, field_validator, model_validator
from pydantic_core import PydanticCustomError

from app.models.enums import ContactChannel, RequestActorRole, RequestStatus
from app.schemas.envelope import ApiModel, PageMeta
from app.schemas.write import StrictRequest, printable

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_CLOCK_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

ServiceText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=80),
    printable(False),
]
DetailsText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=10, max_length=500),
    printable(True),
]
AreaText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=80),
    printable(False),
]
NotesText = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=500), printable(True)
]

# ------------------------------------------------------------------------------ requests


class ServiceRequestCreate(StrictRequest):
    """Everything the requester chooses. ``preferredContactChannel`` is a PREFERENCE only: it sends
    nothing, stores no number and triggers nothing (DECISIONS.md, the O-3 contact model)."""

    provider_listing_id: uuid.UUID
    service: ServiceText
    details: DetailsText
    area: AreaText
    preferred_date: datetime.date
    preferred_time: str | None = None
    notes: NotesText | None = None
    preferred_contact_channel: ContactChannel = ContactChannel.IN_APP

    @field_validator("preferred_date", mode="before")
    @classmethod
    def _date_is_an_iso_string(cls, value: object) -> object:
        """``YYYY-MM-DD`` only: pydantic would also accept an integer timestamp as a date."""
        if not (isinstance(value, str) and _ISO_DATE.fullmatch(value)):
            raise PydanticCustomError("invalid_date", "Use a calendar date written as YYYY-MM-DD.")
        return value

    @field_validator("preferred_time")
    @classmethod
    def _clock_time(cls, value: str | None) -> str | None:
        if value is not None and not _CLOCK_TIME.fullmatch(value):
            raise PydanticCustomError("invalid_time", "Use a 24-hour time written as HH:MM.")
        return value


class ActionRequest(StrictRequest):
    """The body of accept / start / complete / cancel is ``{}`` (or absent): the status is the
    server's to move, so there is nothing a client may set."""


class RequestsQuery(ApiModel):
    status: RequestStatus | None = None
    limit: int = Field(default=12, ge=1, le=50)
    offset: int = Field(default=0, ge=0, le=100_000)

    @model_validator(mode="before")
    @classmethod
    def _blank_is_absent(cls, values: object) -> object:
        if isinstance(values, dict):
            return {key: (None if value == "" else value) for key, value in values.items()}
        return values


# ------------------------------------------------------------------------------ responses


class _RequestFields(ApiModel):
    id: uuid.UUID
    #: ``null`` only if the listing was hard-deleted; ``providerName`` is the snapshot taken at
    #: creation, so the request stays readable whatever happens to the listing afterwards.
    provider_listing_id: uuid.UUID | None = None
    provider_name: str
    service: str
    details: str
    area: str
    preferred_date: datetime.date
    preferred_time: str | None = None
    notes: str | None = None
    preferred_contact_channel: ContactChannel
    status: RequestStatus
    created_at: datetime.datetime
    updated_at: datetime.datetime


class ServiceRequestSummary(_RequestFields):
    """The requester's own row."""


class LeadSummary(_RequestFields):
    """The provider's inbox row: the requester is identified by display name only."""

    requester_name: str


class RequestHistoryEntry(ApiModel):
    from_status: RequestStatus | None = None
    to_status: RequestStatus
    actor_role: RequestActorRole
    created_at: datetime.datetime


class ServiceRequestDetail(_RequestFields):
    requester_name: str
    #: Which party the caller is (never both: nobody can request their own listing).
    viewer_role: RequestActorRole
    history: list[RequestHistoryEntry]


class ServiceRequestEnvelope(ApiModel):
    data: ServiceRequestDetail


class ServiceRequestsEnvelope(ApiModel):
    data: list[ServiceRequestSummary]
    meta: PageMeta


class LeadsEnvelope(ApiModel):
    data: list[LeadSummary]
    meta: PageMeta

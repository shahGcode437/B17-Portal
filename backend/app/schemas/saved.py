"""Saved-list schemas (Phase 12F; docs/backend/API_CONTRACT.md §10.8, §13).

``GET /saved`` returns the PUBLIC card shape of each still-approved saved listing — exactly the
``{kind, item}`` pair the search results use, so the frontend renders it with the same cards —
plus ``savedAt``. The item is the public mapping: no private location, status, revision or owner.
"""

import datetime
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.schemas.envelope import ApiModel, PageMeta
from app.schemas.read import BusinessRead, PropertyRead, ProviderRead, TutorRead


class SavedProvider(ApiModel):
    kind: Literal["provider"]
    item: ProviderRead
    saved_at: datetime.datetime


class SavedBusiness(ApiModel):
    kind: Literal["business"]
    item: BusinessRead
    saved_at: datetime.datetime


class SavedTutor(ApiModel):
    kind: Literal["tutor"]
    item: TutorRead
    saved_at: datetime.datetime


class SavedProperty(ApiModel):
    kind: Literal["property"]
    item: PropertyRead
    saved_at: datetime.datetime


#: News is never saveable, so it is not a member.
SavedHit = Annotated[
    SavedProvider | SavedBusiness | SavedTutor | SavedProperty, Field(discriminator="kind")
]


class SavedQuery(ApiModel):
    limit: int = Field(default=12, ge=1, le=50)
    offset: int = Field(default=0, ge=0, le=100_000)

    @model_validator(mode="before")
    @classmethod
    def _blank_is_absent(cls, values: object) -> object:
        if isinstance(values, dict):
            return {key: (None if value == "" else value) for key, value in values.items()}
        return values


class SavedEnvelope(ApiModel):
    data: list[SavedHit]
    meta: PageMeta

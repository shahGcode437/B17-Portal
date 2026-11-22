"""Request bodies of the staff Provider authoring API (RBAC-D; docs/backend/API_CONTRACT.md §16).

A Service / Professional ("provider") listing is a PORTAL-MANAGED resource: it has no personal owner
(``AUTH_RBAC.md §27.9``, §31), so every one of these bodies describes CONTENT only. A client never
sends — and the server never reads from a body — a ``kind``, a ``vertical``, an ``ownerId``, a
``status``, an actor, a role, a scope, a managed-by marker or an audit field: each is an undeclared
key and answers ``422`` with ``details[].code = "not_allowed"`` (``StrictRequest``), whether its
value is set, ``null`` or empty. The kind is always ``provider`` because the route says so; the
authority is always the live staff role and scope the service locks, never a field of the request.

The field shapes are the same ones the owner write API uses for a provider (``ProviderCreate`` /
``ListingPatch``): the same normalisation, the same location rules, one set of content rules. Only
the fields a provider has exist here, so a Business / Tutor / Property field (``vertical``,
``food``, ``grade``, ``price`` …) is not accepted rather than ignored.

Responses reuse the staff listing detail (``AdminListingEnvelope``): a Super Admin gets the full
shape; a Moderator gets the location projected down to what the public sees (``AUTH_RBAC.md
§27.10``).
"""

from pydantic import Field

from app.schemas.write import (
    MAX_TAGS,
    AreaText,
    Description,
    LocationInput,
    MediaReference,
    Name,
    Revision,
    Slug,
    StrictRequest,
    Tag,
)


class ProviderCreateRequest(StrictRequest):
    """A new Provider. It starts ``pending`` at ``revision 1``, exactly like every other listing."""

    name: Name
    #: A ``services`` category slug (the service type); the service validates it against the live
    #: taxonomy — it must exist, be active and belong to the ``services`` module.
    category: Slug
    area: AreaText
    description: Description
    tags: list[Tag] = Field(default_factory=list, max_length=MAX_TAGS)
    image: MediaReference | None = None
    location: LocationInput | None = None


class ProviderPatchRequest(StrictRequest):
    """``revision`` is the concurrency token the staff member read. Every other field: omitted =
    unchanged, ``null`` clears only ``image``, arrays and ``location`` replace whole — the same
    PATCH semantics as the owner API."""

    revision: Revision
    name: Name | None = None
    category: Slug | None = None
    area: AreaText | None = None
    description: Description | None = None
    tags: list[Tag] | None = Field(default=None, max_length=MAX_TAGS)
    image: MediaReference | None = None
    location: LocationInput | None = None


class ProviderArchiveRequest(StrictRequest):
    revision: Revision

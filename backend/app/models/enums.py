"""Closed value sets and domain limits (docs/backend/DATA_MODEL.md).

Values mirror the frontend vocabulary exactly (``kind`` is ``provider``, not ``service``;
furnishing keeps its display casing). Stored as ``VARCHAR`` + ``CHECK`` — see ``app.db.types``.
"""

from enum import StrEnum

#: FOOD-specific: a Food business chooses 1..3 categories, position 1 being the primary one
#: (docs/product/FOOD_DINING.md, DATA_MODEL.md §5). Every other listing kind has exactly one.
#: This is a service rule — the generic ``listing_categories`` table imposes no such maximum.
MAX_FOOD_CATEGORIES = 3
#: A Food listing carries at most this many menu highlights (DATA_MODEL.md §4.2).
MAX_FOOD_MENU_ITEMS = 8
#: A rejection must carry a specific reason (DATA_MODEL.md §7, row 4).
MIN_REJECTION_REASON_LENGTH = 10


class ListingKind(StrEnum):
    PROVIDER = "provider"
    BUSINESS = "business"
    TUTOR = "tutor"
    PROPERTY = "property"


class ListingStatus(StrEnum):
    """No ``draft`` — the current lifecycle is submit-only (DATA_MODEL.md §7)."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class BusinessVertical(StrEnum):
    """Food & Dining is a *vertical of Business*, never a listing kind."""

    GENERAL = "general"
    FOOD = "food"


class CategoryModule(StrEnum):
    """Code-defined product areas of the listing TAXONOMY (and News). A category lives inside a
    module; it never creates one. This is not the staff permission vocabulary: see
    :class:`StaffScope`."""

    SERVICES = "services"
    DIRECTORY = "directory"
    FOOD = "food"
    EDUCATION = "education"
    PROPERTY = "property"
    NEWS = "news"


class StaffScope(StrEnum):
    """The one canonical vocabulary of staff AUTHORITY: what a Moderator can be assigned
    (docs/backend/AUTH_RBAC.md §32). It is separate from the listing taxonomy: adding a staff
    scope creates no category, listing kind or module.

    Which values confer what is decided in ``app/services/staff_scopes.py`` (listing scopes,
    Grocery, reserved). The listing scopes share their names with the taxonomy module whose listings
    they moderate. ``grocery`` is a staff scope ONLY; ``news`` is reserved and confers nothing.

    A ``StrEnum`` member compares equal to a same-named member of another ``StrEnum``, so Python
    will not notice a ``CategoryModule`` used where a ``StaffScope`` belongs: mypy does."""

    SERVICES = "services"
    DIRECTORY = "directory"
    FOOD = "food"
    EDUCATION = "education"
    PROPERTY = "property"
    NEWS = "news"
    GROCERY = "grocery"


class FoodServiceOption(StrEnum):
    """ "delivery" means delivery arranged by the business — never by B-17 Portal."""

    DINE_IN = "dine-in"
    TAKEAWAY = "takeaway"
    DELIVERY = "delivery"


class PropertyListingType(StrEnum):
    SALE = "sale"
    RENT = "rent"


class Furnishing(StrEnum):
    FURNISHED = "Furnished"
    UNFURNISHED = "Unfurnished"
    SEMI_FURNISHED = "Semi-Furnished"


class LocationVisibility(StrEnum):
    """How much of a listing's location the public may see (docs/backend/LOCATION_MAP.md §7).

    ``area_only`` is also the safe default for legacy rows: it stores no point at all.
    """

    EXACT = "exact"
    APPROXIMATE = "approximate"
    AREA_ONLY = "area_only"


class HistoryAction(StrEnum):
    SUBMITTED = "submitted"
    RESUBMITTED = "resubmitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class ActorRole(StrEnum):
    """Who a ``listing_status_history`` row says acted. ``admin`` is a Super Admin (the stored role
    value is not renamed); ``moderator`` exists in the vocabulary from RBAC-A but nothing writes it
    until RBAC-B (docs/backend/AUTH_RBAC.md §27)."""

    OWNER = "owner"
    ADMIN = "admin"
    MODERATOR = "moderator"


class RequestStatus(StrEnum):
    """Service-request lifecycle (Phase 12F). The wire value is ``in-progress`` (hyphen), exactly as
    the frontend's ``RequestStatus`` and DATA_MODEL.md §16 spell it."""

    SUBMITTED = "submitted"
    ACCEPTED = "accepted"
    IN_PROGRESS = "in-progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ContactChannel(StrEnum):
    """The requester's PREFERRED way to be reached (DECISIONS.md, O-3). Metadata only: choosing
    ``whatsapp`` or ``phone`` sends nothing and stores no number."""

    IN_APP = "in_app"
    WHATSAPP = "whatsapp"
    PHONE = "phone"


class RequestActorRole(StrEnum):
    REQUESTER = "requester"
    PROVIDER = "provider"


class UserStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETED = "deleted"


class RoleName(StrEnum):
    """Explicit role grants only. Resident is every account; professional is a profile row.

    ``admin`` is the stored value of the **Super Admin** role (docs/backend/AUTH_RBAC.md §27.2): the
    value is never renamed, only its meaning is named. ``moderator`` is limited staff whose
    authority exists only through scope assignments (``staff_scope_assignments``); the two roles are
    mutually exclusive (a database trigger enforces it)."""

    ADMIN = "admin"
    MODERATOR = "moderator"


class AuthProvider(StrEnum):
    GOOGLE = "google"
    FACEBOOK = "facebook"
    APPLE = "apple"


class PlanCode(StrEnum):
    FREE = "free"
    PREMIUM = "premium"


class NewsKind(StrEnum):
    NEWS = "news"
    UPDATE = "update"


class NewsStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"


class AuthTokenPurpose(StrEnum):
    """What a one-time ``auth_tokens`` row may be redeemed for (docs/backend/AUTH_RBAC.md §8)."""

    EMAIL_VERIFICATION = "email_verification"
    PASSWORD_RESET = "password_reset"


class SessionRevokeReason(StrEnum):
    """Why a session was revoked (AUTH_RBAC.md §4.2). Never user-supplied."""

    LOGOUT = "logout"
    LOGOUT_ALL = "logout_all"
    PASSWORD_RESET = "password_reset"
    PASSWORD_CHANGE = "password_change"
    ADMIN_ACTION = "admin_action"
    SUSPENDED = "suspended"
    ROLE_CHANGE = "role_change"
    SESSION_CAP = "session_cap"
    ACCOUNT_CLAIMED = "account_claimed"


class AuthEventType(StrEnum):
    """The closed audit vocabulary (AUTH_RBAC.md §13.2); identity/claim events are used by 11C."""

    REGISTER = "register"
    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILURE = "login_failure"
    LOGOUT = "logout"
    LOGOUT_ALL = "logout_all"
    SESSION_REVOKED = "session_revoked"
    PASSWORD_CHANGED = "password_changed"
    PASSWORD_RESET_REQUESTED = "password_reset_requested"
    PASSWORD_RESET_COMPLETED = "password_reset_completed"
    EMAIL_VERIFICATION_SENT = "email_verification_sent"
    EMAIL_VERIFIED = "email_verified"
    IDENTITY_LINKED = "identity_linked"
    IDENTITY_UNLINKED = "identity_unlinked"
    ACCOUNT_CLAIMED = "account_claimed"
    ROLE_GRANTED = "role_granted"
    ROLE_REVOKED = "role_revoked"
    ACCOUNT_SUSPENDED = "account_suspended"
    ACCOUNT_REACTIVATED = "account_reactivated"


class StaffAuditSource(StrEnum):
    """Where a staff action came from: the web API, or the operator CLI (which has no web actor)."""

    WEB = "web"
    CLI = "cli"


class StaffAuditAction(StrEnum):
    """The closed vocabulary of the durable staff audit (docs/backend/AUTH_RBAC.md §27.11).

    Nothing writes most of these yet: RBAC-B writes the override, RBAC-C the staff changes, RBAC-D
    the provider mutations, RBAC-G the taxonomy ones. They are in the vocabulary (and the database
    CHECK) from RBAC-A so no later phase has to widen a closed set to record its own event."""

    MODERATOR_APPOINTED = "moderator_appointed"
    MODERATOR_PAUSED = "moderator_paused"
    MODERATOR_REMOVED = "moderator_removed"
    SCOPE_GRANTED = "scope_granted"
    SCOPE_REVOKED = "scope_revoked"
    SUPER_ADMIN_PROMOTED = "super_admin_promoted"
    SUPER_ADMIN_DEMOTED = "super_admin_demoted"
    MODERATION_SELF_OVERRIDE = "moderation_self_override"
    PROVIDER_CREATED = "provider_created"
    PROVIDER_UPDATED = "provider_updated"
    PROVIDER_ARCHIVED = "provider_archived"
    TAXONOMY_CREATED = "taxonomy_created"
    TAXONOMY_UPDATED = "taxonomy_updated"
    TAXONOMY_REORDERED = "taxonomy_reordered"


class StaffAuditResource(StrEnum):
    """What a staff audit event's ``resource_id`` points at (no foreign key: see the model)."""

    LISTING = "listing"
    CATEGORY = "category"


class OAuthPurpose(StrEnum):
    """What an OAuth round trip is for: sign in, or connect a provider to the signed-in account."""

    LOGIN = "login"
    LINK = "link"

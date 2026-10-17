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
    """Code-defined product areas. A category lives inside a module; it never creates one."""

    SERVICES = "services"
    DIRECTORY = "directory"
    FOOD = "food"
    EDUCATION = "education"
    PROPERTY = "property"
    NEWS = "news"


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
    OWNER = "owner"
    ADMIN = "admin"


class UserStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETED = "deleted"


class RoleName(StrEnum):
    """Explicit role grants only. Resident is every account; professional is a profile row."""

    ADMIN = "admin"


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


class OAuthPurpose(StrEnum):
    """What an OAuth round trip is for: sign in, or connect a provider to the signed-in account."""

    LOGIN = "login"
    LINK = "link"

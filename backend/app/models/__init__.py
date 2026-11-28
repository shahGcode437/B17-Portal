"""ORM models. Importing this package registers every table on ``Base.metadata``."""

from app.models.auth import AuthEvent, AuthRateLimit, AuthSession, AuthToken, OAuthFlow
from app.models.grocery import (
    GroceryDailyCapacity,
    GroceryOrder,
    GroceryOrderConfirmation,
    GroceryOrderEvent,
    GroceryOrderItem,
    GroceryOrderStatusHistory,
    GroceryPayment,
    GroceryRefund,
    GrocerySettingsRevision,
)
from app.models.listings import (
    BusinessProfile,
    FoodMenuItem,
    FoodProfile,
    Listing,
    ListingStatusHistory,
    PropertyProfile,
    TutorProfile,
)
from app.models.news import NewsArticle
from app.models.requests import ServiceRequest, ServiceRequestStatusHistory
from app.models.saved import SavedItem
from app.models.staff import StaffAuditEvent, StaffScopeAssignment
from app.models.taxonomy import Category, ListingCategory
from app.models.users import AuthIdentity, ProfessionalProfile, User, UserRole

__all__ = [
    "AuthEvent",
    "AuthIdentity",
    "AuthRateLimit",
    "AuthSession",
    "AuthToken",
    "BusinessProfile",
    "Category",
    "FoodMenuItem",
    "FoodProfile",
    "GroceryDailyCapacity",
    "GroceryOrder",
    "GroceryOrderConfirmation",
    "GroceryOrderEvent",
    "GroceryOrderItem",
    "GroceryOrderStatusHistory",
    "GroceryPayment",
    "GroceryRefund",
    "GrocerySettingsRevision",
    "Listing",
    "ListingCategory",
    "ListingStatusHistory",
    "NewsArticle",
    "OAuthFlow",
    "ProfessionalProfile",
    "PropertyProfile",
    "SavedItem",
    "ServiceRequest",
    "ServiceRequestStatusHistory",
    "StaffAuditEvent",
    "StaffScopeAssignment",
    "TutorProfile",
    "User",
    "UserRole",
]

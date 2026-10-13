"""ORM models. Importing this package registers every table on ``Base.metadata``."""

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
from app.models.saved import SavedItem
from app.models.taxonomy import Category, ListingCategory
from app.models.users import AuthIdentity, ProfessionalProfile, User, UserRole

__all__ = [
    "AuthIdentity",
    "BusinessProfile",
    "Category",
    "FoodMenuItem",
    "FoodProfile",
    "Listing",
    "ListingCategory",
    "ListingStatusHistory",
    "NewsArticle",
    "ProfessionalProfile",
    "PropertyProfile",
    "SavedItem",
    "TutorProfile",
    "User",
    "UserRole",
]

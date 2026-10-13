"""Resident favorites: one table for every listing kind (the kind is derived via the listing)."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SavedItem(Base):
    """``PRIMARY KEY (user_id, listing_id)``: a user cannot save the same listing twice.

    The row survives a listing becoming non-public (pending after an edit, rejected, archived);
    hiding it is the *query's* job (later phases), so it reappears if the listing is re-approved.
    Both foreign keys CASCADE: a hard-deleted listing, or a tombstoned account, removes the
    favorite — it has no meaning without either side.
    """

    __tablename__ = "saved_items"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


Index("ix_saved_items_user_id_created_at", SavedItem.user_id, SavedItem.created_at.desc())

/**
 * The backend's input bounds for a listing (API_CONTRACT §11 "Input bounds", `schemas/write.py`):
 * abuse limits that the forms mirror so a person is told BEFORE a submit, in plain words, instead of by a
 * `422`. The server stays the authority; if it ever changes a number, it changes here too.
 */

/** `tags`: at most 20 per listing ... */
export const MAX_TAGS = 20
/** ... each at most 40 characters (after trimming). */
export const MAX_TAG_LENGTH = 40
/** `location.block`: at most 40 characters (LOCATION_MAP.md §4). */
export const MAX_BLOCK_LENGTH = 40
/** `location.address` and `location.landmark` (`LocationInput` in `schemas/write.py`). */
export const MAX_ADDRESS_LENGTH = 200
export const MAX_LANDMARK_LENGTH = 100
/** `name` 2-80, `title` 2-100, `description` 20-400 (`Name`, `Title`, `Description`). */
export const MAX_NAME_LENGTH = 80
export const MAX_TITLE_LENGTH = 100
export const MIN_DESCRIPTION_LENGTH = 20
export const MAX_DESCRIPTION_LENGTH = 400
/** A tutor's `grade` 1-60, a property's `price` 1-40 (a display string, never parsed), `bedrooms` 0-30. */
export const MAX_GRADE_LENGTH = 60
export const MAX_PRICE_LENGTH = 40
export const MAX_BEDROOMS = 30

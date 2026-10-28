/**
 * What the API calls "printable" (`_printable` in `backend/app/schemas/write.py`, Python's `str.isprintable()`):
 * no control characters and no hidden or odd space characters. A non-breaking space pasted from a web page or a
 * chat is the usual culprit, and it is invisible, so the server's `invalid_characters` would be a mystery. A
 * one-line field also refuses line breaks and tabs; a description allows them.
 *
 * The forms check this BEFORE they send. The server stays the authority; nothing here relaxes a server check.
 */
const UNPRINTABLE_ONE_LINE = /(?! )[\p{C}\p{Z}]/u
const UNPRINTABLE_TEXT = /(?![ \n\r\t])[\p{C}\p{Z}]/u

export const NOT_PLAIN_TEXT = "Please use plain text only (no tabs, line breaks or hidden characters such as a non-breaking space)."

export const isOneLine = (value: string): boolean => !UNPRINTABLE_ONE_LINE.test(value)
export const isPlainText = (value: string): boolean => !UNPRINTABLE_TEXT.test(value)

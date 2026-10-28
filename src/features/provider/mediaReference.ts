import { isOneLine } from "@/features/provider/textRules"

/** `MediaReference` in `backend/app/schemas/write.py`. */
const MAX_MEDIA_REFERENCE_LENGTH = 2048

/**
 * Is this value one the API accepts as a media reference? A public `https://` address or a site-relative path, and
 * nothing else (`is_valid_media_reference`, MEDIA_STORAGE.md): not `blob:` / `data:` / `http:`, no spaces, no
 * credentials in the address, no `//` or `..` in a path. There is no field to type one in the forms (uploads arrive
 * with Phase 13); this is what decides whether a STORED reference may be sent back unchanged on an edit.
 */
export function isValidMediaReference(value: string): boolean {
  if (value === "" || value.length > MAX_MEDIA_REFERENCE_LENGTH) return false
  if (/\s/.test(value) || !isOneLine(value) || value.includes("\\")) return false
  if (value.startsWith("/")) return !value.startsWith("//") && !value.split("/").includes("..")
  if (!/^https:\/\/[^/?#\s]/i.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === ""
  } catch {
    return false
  }
}

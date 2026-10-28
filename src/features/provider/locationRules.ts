import { MAX_ADDRESS_LENGTH, MAX_BLOCK_LENGTH, MAX_LANDMARK_LENGTH } from "@/config/listingLimits"
import { NOT_PLAIN_TEXT, isOneLine } from "@/features/provider/textRules"

/**
 * Client-side mirror of the backend's `block` rule (LOCATION_MAP.md §4, `validate_location`): optional, at
 * most 40 characters, letters / digits / space / `-` / `/` / `.`, starting with a letter or a digit. The
 * server stays the authority (`422 invalid_format`); this only avoids a round trip for a typo.
 */
export { MAX_BLOCK_LENGTH }

const BLOCK_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} \-/.]*$/u

export const BLOCK_MESSAGE = `Use letters, numbers, spaces, "-", "/" or "." (up to ${MAX_BLOCK_LENGTH} characters), starting with a letter or number.`

/** What is wrong with a block, or `null` (blank is fine: the block is optional). */
export function blockProblem(block: string | undefined): string | null {
  const value = (block ?? "").trim()
  if (value === "") return null
  if (value.length > MAX_BLOCK_LENGTH || !BLOCK_PATTERN.test(value)) return BLOCK_MESSAGE
  return null
}

/** The street address: optional here, at most 200 characters, on one line, plain characters only. */
export function addressProblem(address: string | undefined): string | null {
  const value = (address ?? "").trim()
  if (value.length > MAX_ADDRESS_LENGTH) return `Please keep the address under ${MAX_ADDRESS_LENGTH} characters.`
  if (!isOneLine(value)) return "Please keep the address on one line, with plain characters only (no line breaks or hidden characters)."
  return null
}

/** The landmark: optional, at most 100 characters, on one line, plain characters only. */
export function landmarkProblem(landmark: string | undefined): string | null {
  const value = (landmark ?? "").trim()
  if (value.length > MAX_LANDMARK_LENGTH) return `Please keep the landmark under ${MAX_LANDMARK_LENGTH} characters.`
  if (!isOneLine(value)) return NOT_PLAIN_TEXT
  return null
}

/** Every text problem of a location block, keyed like the server's `location.*` field errors. Empty when fine. */
export function locationTextProblems(location: { block?: string; address?: string; landmark?: string }): Record<string, string> {
  const problems: Record<string, string> = {}
  const block = blockProblem(location.block)
  if (block) problems["location.block"] = block
  const address = addressProblem(location.address)
  if (address) problems["location.address"] = address
  const landmark = landmarkProblem(location.landmark)
  if (landmark) problems["location.landmark"] = landmark
  return problems
}

import type { StatusCountsDto } from "@/lib/api/dto/private"

/** Reads `meta.counts` defensively: a missing or malformed bucket is 0, never a guess. */
export function parseCounts(value: unknown): StatusCountsDto {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  const read = (key: string): number => {
    const n = source[key]
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0
  }
  return { pending: read("pending"), approved: read("approved"), rejected: read("rejected"), archived: read("archived") }
}

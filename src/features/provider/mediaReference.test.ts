import { describe, expect, it } from "vitest"
import { isValidMediaReference } from "@/features/provider/mediaReference"
import { isValidMediaReference as serverRule } from "@/test/fixtures/listingRules"

/**
 * Which stored picture references may be sent back on an edit: the ones the API accepts, and no others. The mock
 * server's rule (`listingRules.ts`, written from the backend) must give the same answer on every value.
 */
const ACCEPTED = ["https://images.example.org/a.jpg", "https://example.org", "https://cdn.example.org/a%20b.png?w=400#top", "/assets/solar.jpg"]
const REFUSED = [
  "",
  "http://images.example.org/a.jpg",
  "ftp://example.org/a.jpg",
  "blob:http://localhost:5173/6f1c",
  "data:image/png;base64,AAAA",
  "javascript:alert(1)",
  "//cdn.example.org/a.jpg",
  "/../etc/passwd",
  "https:/example.org/a.jpg",
  "https://",
  "https://user:secret@example.org/a.jpg",
  "https://example.org/a b.jpg",
  "https://example.org\\a.jpg",
  "photo.jpg",
  "https://example.org/a b.jpg",
  `https://example.org/${"a".repeat(2050)}`,
]

describe("isValidMediaReference", () => {
  it.each(ACCEPTED)("accepts %s", (value) => expect(isValidMediaReference(value)).toBe(true))
  it.each(REFUSED.map((value) => [value.length > 60 ? `${value.slice(0, 40)}…(${value.length})` : value, value] as const))("refuses %j", (_, value) =>
    expect(isValidMediaReference(value)).toBe(false)
  )

  it("agrees with the server on every value above (the server's 2048-character limit is a separate request-model check)", () => {
    for (const value of [...ACCEPTED, ...REFUSED]) {
      const serverAccepts = value !== "" && value.length <= 2048 && serverRule(value)
      expect(isValidMediaReference(value), value.slice(0, 60)).toBe(serverAccepts)
    }
  })
})

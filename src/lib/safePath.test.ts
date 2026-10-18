import { describe, expect, it } from "vitest"
import { backendReturnTo, safeLocalPath } from "@/lib/safePath"

describe("safeLocalPath (open-redirect guard)", () => {
  it.each(["/", "/saved", "/profile/requests", "/search?q=solar&type=provider", "/providers/abc#top", "/caf%C3%A9"])(
    "accepts %s",
    (value) => expect(safeLocalPath(value)).toBe(value)
  )

  it.each([
    "",
    "saved",
    "https://evil.example",
    "http://evil.example/x",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\evil.example",
    "javascript:alert(1)",
    "data:text/html,x",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "/%255Cevil.example",
    "/a/../b",
    "/a/./b",
    "/%2e%2e/secret",
    "/a\nb",
    "/a b",
    "/api",
    "/api/v1/auth/me",
    "/API/v1",
    "/x".repeat(200),
  ])("rejects %j", (value) => expect(safeLocalPath(value)).toBeNull())

  it("rejects non-strings", () => {
    for (const value of [undefined, null, 5, {}, ["/x"]]) expect(safeLocalPath(value)).toBeNull()
  })
})

describe("backendReturnTo", () => {
  it("keeps only the path (the backend takes no query string) and drops the trivial destinations", () => {
    expect(backendReturnTo("/providers/abc?x=1#y")).toBe("/providers/abc")
    expect(backendReturnTo("/")).toBeUndefined()
    expect(backendReturnTo("/login")).toBeUndefined()
    expect(backendReturnTo("https://evil.example")).toBeUndefined()
    expect(backendReturnTo(undefined)).toBeUndefined()
  })
})

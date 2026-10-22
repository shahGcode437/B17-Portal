import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api/errors"
import { isConflict, isNoChanges, userMessageFor } from "@/lib/api/writeErrors"

const apiError = (status: number, code: string, details: { field?: string; code?: string }[] = []) =>
  new ApiError({ status, code, message: "server text", details, requestId: "r" })

describe("writeErrors classification (matches API_CONTRACT §10)", () => {
  it("recognises an unedited rejected resubmission: 422 validation_error with details[].code no_changes", () => {
    const error = apiError(422, "validation_error", [{ field: "request", code: "no_changes" }])
    expect(isNoChanges(error)).toBe(true)
    expect(isConflict(error)).toBe(false)
  })

  it("does not mistake other validation errors, or a bare top-level code, for no_changes", () => {
    expect(isNoChanges(apiError(422, "validation_error", [{ field: "name", code: "required" }]))).toBe(false)
    expect(isNoChanges(apiError(422, "no_changes"))).toBe(false)
    expect(isNoChanges(new Error("boom"))).toBe(false)
  })

  it("never shows raw server text for a validation error", () => {
    const copy = userMessageFor(apiError(422, "validation_error"), "patch-listing")
    expect(copy.title).toBe("Please check the form")
    expect(JSON.stringify(copy)).not.toContain("server text")
  })
})

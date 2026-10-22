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

  it("maps the request eligibility rules from details[].code (the real 422 shape), not a top-level code", () => {
    const own = userMessageFor(apiError(422, "validation_error", [{ field: "providerListingId", code: "own_listing" }]), "create-request")
    expect(own.title).toBe("You cannot send a request to your own listing")
    const wrongKind = userMessageFor(apiError(422, "validation_error", [{ field: "providerListingId", code: "not_requestable" }]), "create-request")
    expect(wrongKind.title).toBe("This listing cannot receive requests")
  })

  it("explains a duplicate name (409 conflict + details duplicate) instead of a generic failure", () => {
    const copy = userMessageFor(apiError(409, "conflict", [{ field: "name", code: "duplicate" }]), "category-create")
    expect(copy.title).toBe("That name is already in use")
    expect(userMessageFor(apiError(409, "conflict"), "category-create").title).toBe("This conflicts with the current state")
  })

  it("never shows raw server text for a validation error", () => {
    const copy = userMessageFor(apiError(422, "validation_error"), "patch-listing")
    expect(copy.title).toBe("Please check the form")
    expect(JSON.stringify(copy)).not.toContain("server text")
  })
})

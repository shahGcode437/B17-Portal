import { describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"
import { describeDetail, friendlyFieldErrors, isConflict, isNoChanges, userMessageFor, type WriteOperation, copyAsSentence } from "@/lib/api/writeErrors"

const apiError = (status: number, code: string, details: { field?: string; code?: string; message?: string }[] = []) =>
  new ApiError({ status, code, message: "server text", details, requestId: "r" })

/** The real API's own wording for each rejection (captured from the live backend, Phase 12S S4). */
const REAL = {
  tags21: { field: "tags", code: "too_long", message: "List should have at most 20 items after validation, not 21" },
  tag41: { field: "tags.0", code: "string_too_long", message: "String should have at most 40 characters" },
  locality: { field: "area", code: "unknown_locality", message: "Choose one of: B-17." },
  blockFormat: { field: "location.block", code: "invalid_format", message: "Use letters, numbers, spaces, '-', '/' or '.' (up to 40 characters)." },
  blockLong: { field: "location.block", code: "string_too_long", message: "String should have at most 40 characters" },
  nameShort: { field: "name", code: "string_too_short", message: "String should have at least 2 characters" },
  missing: { field: "description", code: "missing", message: "Field required" },
  category: { field: "category", code: "unknown_category", message: "Unknown category 'not-a-slug'." },
  media: { field: "image", code: "invalid_media_reference", message: "Use a public https:// address or a site path; uploads are not available yet." },
  property: { field: "location.visibility", code: "not_allowed", message: "A property needs a map pin; choose exact or approximate." },
  past: { field: "preferredDate", code: "in_the_past", message: "Choose today or a later date." },
  far: { field: "preferredDate", code: "too_far_ahead", message: "Choose a date within the next 365 days." },
} as const

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

  it("the not-verified message never points at an inbox in development, and never claims an e-mail in production", () => {
    const error = apiError(403, "email_not_verified")
    const dev = userMessageFor(error, "create-professional-profile")
    expect(dev.title).toBe("Please verify your email first")
    expect(dev.description).toMatch(/no e-mail is sent/i)
    expect(dev.description).not.toMatch(/inbox/i)

    vi.stubEnv("DEV", false)
    try {
      const production = userMessageFor(error, "create-professional-profile")
      expect(production.description).toBe("Verify your email address from your Profile page, then try again.")
      // Production e-mail delivery does not exist yet: nothing here may say or imply that a message was sent (S5A).
      expect(JSON.stringify(production)).not.toMatch(/inbox|we sent|on its way|check your e-?mail/i)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("never shows raw server text for a validation error", () => {
    const copy = userMessageFor(apiError(422, "validation_error"), "patch-listing")
    expect(copy.title).toBe("Please check the form")
    expect(JSON.stringify(copy)).not.toContain("server text")
  })
})

describe("write errors are mapped to plain copy, never to the server's raw text (S4)", () => {
  const copyFor = (details: { field?: string; code?: string; message?: string }[], op: WriteOperation = "create-listing") =>
    userMessageFor(apiError(422, "validation_error", details), op)

  it("tags: more than 20 and a tag over 40 characters, both from the real response shape", () => {
    expect(copyFor([REAL.tags21]).description).toBe("You can add up to 20 tags.")
    expect(copyFor([REAL.tag41]).description).toBe("Each tag can be up to 40 characters.")
  })

  it("area: an unknown locality says which one to choose and where the block goes", () => {
    const copy = copyFor([REAL.locality])
    expect(copy.title).toBe("Please check the form")
    expect(copy.description).toBe("Choose B-17 as the area. Put your block or street in the Block field.")
  })

  it("block, short / missing fields, unknown category, image and property-pin rules each get their own sentence", () => {
    expect(copyFor([REAL.blockFormat]).description).toMatch(/^Use letters, numbers, spaces/)
    expect(copyFor([REAL.blockLong]).description).toBe("The block can be up to 40 characters.")
    expect(copyFor([REAL.nameShort]).description).toBe("The name is too short.")
    expect(copyFor([REAL.missing]).description).toBe("The description is required.")
    expect(copyFor([REAL.category]).description).toBe("Choose a category from the list.")
    expect(copyFor([REAL.media]).description).toBe("Images can't be uploaded yet. Remove the image and try again.")
    expect(copyFor([REAL.property]).description).toBe("A property needs a map pin. Choose exact or approximate.")
  })

  it("request dates: in the past and more than a year ahead", () => {
    expect(copyFor([REAL.past], "create-request")).toEqual({ title: "The request can't be sent as-is", description: "Choose today or a later date." })
    expect(copyFor([REAL.far], "create-request").description).toBe("Choose a date within the next 365 days.")
  })

  it("uses the first problem that has a mapping, and never prints a Pydantic sentence for a mapped one", () => {
    const copy = copyFor([{ field: "weird", code: "something_new", message: "Something unmapped" }, REAL.tags21])
    expect(copy.description).toBe("You can add up to 20 tags.")
    for (const detail of Object.values(REAL)) {
      expect(JSON.stringify(copyFor([detail]))).not.toMatch(/List should|String should|Field required|Unknown category|after validation/)
    }
  })

  it("an UNMAPPED code never falls back to the server's sentence or to a bare code: it gets one concise generic line (S5A / B-07)", () => {
    const generic = "Some fields need a change. Check the form and try again."
    expect(copyFor([{ field: "x", code: "brand_new_rule", message: "Brand new rule broken." }]).description).toBe(generic)
    expect(copyFor([{ field: "x", code: "brand_new_rule" }]).description).toBe(generic)
    expect(copyFor([{ field: "x", code: "brand_new_rule", message: "Brand new rule broken." }], "create-request").description).toBe(
      "Some details need a change. Check them and try again."
    )
    // No details at all (or an empty list) is the same: a validation error always reads as one clean sentence.
    expect(copyFor([]).description).toBe(generic)
  })

  it("no raw Pydantic or technical sentence reaches the user, for a mapped or an unmapped code, for any operation", () => {
    const technical = [
      "String should have at least 2 characters",
      "Field required",
      "Input should be a valid string",
      "value is not a valid email address: An email address must have an @-sign.",
      "List should have at most 20 items after validation, not 21",
      "Input should be 'in_app', 'whatsapp' or 'phone'",
    ]
    const operations: WriteOperation[] = ["create-listing", "patch-listing", "create-request", "request-action", "admin-reject", "category-create"]
    for (const op of operations) {
      for (const message of technical) {
        for (const code of ["string_too_short", "missing", "enum", "value_error", "totally_new_code"]) {
          const copy = copyFor([{ field: "somefield", code, message }], op)
          expect(JSON.stringify(copy), `${op} ${code}`).not.toContain(message)
          expect(JSON.stringify(copy), `${op} ${code}`).not.toMatch(/should have|Field required|Input should|not a valid|after validation/)
        }
      }
    }
  })

  it("a mapped code keeps its useful sentence (the generic line replaces nothing that was mapped)", () => {
    expect(copyFor([{ field: "name", code: "string_too_short", message: "String should have at least 2 characters" }]).description).toBe(
      "The name is too short."
    )
    expect(copyFor([{ field: "description", code: "missing", message: "Field required" }]).description).toBe("The description is required.")
  })

  it("describeDetail and friendlyFieldErrors share the mapping (the form's inline messages are the same sentences)", () => {
    expect(describeDetail(REAL.locality)).toBe(copyFor([REAL.locality]).description)
    const fields = friendlyFieldErrors(apiError(422, "validation_error", [REAL.blockFormat, REAL.locality, { field: "x", code: "unmapped", message: "raw" }]))
    expect(fields["location.block"]).toMatch(/^Use letters, numbers/)
    expect(fields.area).toMatch(/^Choose B-17/)
    expect(fields.x).toBeUndefined() // a raw, unmapped sentence is not put on a field
  })
})

describe("the other write failures, one clear sentence each (S4)", () => {
  const copy = (status: number, code: string, op: WriteOperation = "create-listing", details: { field?: string; code?: string }[] = []) =>
    userMessageFor(apiError(status, code, details), op)

  it("csrf_failed no longer promises that refreshing fixes it", () => {
    const c = copy(403, "csrf_failed")
    expect(c.title).toBe("Your secure session could not be verified")
    expect(c.description).toMatch(/reload the page and try again/i)
    expect(c.description).toMatch(/log out and log in again/i)
    expect(JSON.stringify(c)).not.toMatch(/refresh the page|Secure session issue/)
  })

  it("the whole list from the brief is mapped (none falls through to the generic message)", () => {
    const generic = "Something went wrong"
    const cases: [string, ReturnType<typeof copy>][] = [
      ["plan_limit_reached", copy(403, "plan_limit_reached")],
      ["professional_profile_required", copy(403, "professional_profile_required")],
      ["email_not_verified", copy(403, "email_not_verified")],
      ["listing_conflict", copy(409, "listing_conflict", "patch-listing")],
      ["invalid_state_transition", copy(409, "invalid_state_transition", "archive-listing")],
      ["duplicate conflict", copy(409, "conflict", "category-create", [{ field: "name", code: "duplicate" }])],
      ["rate_limited", copy(429, "rate_limited")],
      ["forbidden", copy(403, "forbidden")],
      ["own_listing", copy(422, "validation_error", "create-request", [{ field: "providerListingId", code: "own_listing" }])],
      ["not_requestable", copy(422, "validation_error", "create-request", [{ field: "providerListingId", code: "not_requestable" }])],
    ]
    for (const [name, c] of cases) expect(c.title, name).not.toBe(generic)
  })

  it("rate limits say what was limited", () => {
    expect(copy(429, "rate_limited", "create-request").title).toBe("You've sent too many requests")
    expect(copy(429, "rate_limited", "create-request").description).toMatch(/one request to the same provider per day/)
    expect(copy(429, "rate_limited", "create-listing").title).toBe("You've submitted several listings recently")
  })

  it("a server failure is a server failure, a lost connection is a lost connection", () => {
    expect(copy(503, "service_unavailable").title).toBe("The server had a problem")
    expect(copy(500, "internal_error").title).toBe("The server had a problem")
    expect(userMessageFor(new ApiError({ status: 0, code: "network_error", message: "x" }), "create-listing").title).toBe("The server could not be reached")
    expect(userMessageFor(new Error("boom"), "create-listing").title).toBe("The server could not be reached")
  })

  it("a 404 names the thing that is gone, by what was being done", () => {
    const titles: [WriteOperation, string][] = [
      ["save-listing", "This listing is not available"],
      ["create-request", "This provider isn't available"],
      ["request-action", "Request not found"],
      ["patch-listing", "Listing not found"],
      ["archive-listing", "Listing not found"],
      ["admin-approve", "Listing not found"],
      ["category-patch", "Category not found"],
    ]
    for (const [op, title] of titles) expect(copy(404, "not_found", op).title, op).toBe(title)
    expect(copy(404, "not_found", "create-listing").title).toBe("Not found") // nothing more specific to say
  })
})

describe("copyAsSentence: a toast shows ONE line, so it carries the title and the next step", () => {
  it("joins the title and the description, without doubling the full stop", () => {
    expect(copyAsSentence({ title: "This listing is not available", description: "Refresh the page and try again." })).toBe(
      "This listing is not available. Refresh the page and try again."
    )
    expect(copyAsSentence({ title: "Could not save.", description: "Try again." })).toBe("Could not save. Try again.")
  })

  it("is just the title when there is nothing more to say", () => {
    expect(copyAsSentence({ title: "Saved" })).toBe("Saved")
    expect(copyAsSentence({ title: "Saved", description: "" })).toBe("Saved")
  })
})

describe("plan_limit_reached points only at an action that exists today (Step A: archiving, never an upgrade)", () => {
  const planLimit = (op: WriteOperation) => userMessageFor(apiError(403, "plan_limit_reached"), op)

  it("creating: the limit, and archive an active listing before creating another", () => {
    expect(planLimit("create-listing")).toEqual({
      title: "Active listing limit reached",
      description: "You've reached the active listing limit for your current plan. Archive an active listing before creating another.",
    })
  })

  it("resubmitting a rejected listing (a failed edit) needs a free slot too, and says so", () => {
    expect(planLimit("patch-listing").description).toBe(
      "You've reached the active listing limit for your current plan. Archive an active listing before resubmitting this one."
    )
  })

  it("never mentions an upgrade, a Premium plan, the raw code or the server's own text, for any operation", () => {
    const operations: WriteOperation[] = [
      "create-listing", "patch-listing", "archive-listing", "save-listing", "unsave-listing", "create-request", "request-action",
      "admin-approve", "admin-reject", "category-create", "category-patch", "category-reorder", "create-professional-profile",
    ]
    for (const op of operations) {
      const text = JSON.stringify(planLimit(op))
      expect(text, op).not.toMatch(/upgrade|premium|subscri|payment|plan_limit_reached|server text/i)
    }
  })

  it("reads as one toast sentence", () => {
    expect(copyAsSentence(planLimit("create-listing"))).toBe(
      "Active listing limit reached. You've reached the active listing limit for your current plan. Archive an active listing before creating another."
    )
  })
})

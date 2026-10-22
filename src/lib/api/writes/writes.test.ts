import { afterEach, describe, expect, it, vi } from "vitest"
import { createProfessionalProfile } from "@/lib/api/writes/professional"
import { saveListing, unsaveListing } from "@/lib/api/writes/saved"
import { actOnRequest, createRequest } from "@/lib/api/writes/requests"
import { archiveListing, createListing, patchListing } from "@/lib/api/writes/listings"
import { approveListing, createCategory, patchCategory, rejectListing, reorderCategories } from "@/lib/api/writes/admin"
import { installFetchMock, meBody, ok, fail } from "@/test/apiMock"
import { setCsrfToken } from "@/lib/api/session"

afterEach(() => {
  vi.unstubAllGlobals()
})

const path = (call: { url: string }) => new URL(call.url, "http://x").pathname.replace(/^.*\/api\/v1/, "")

describe("write API modules", () => {
  it("professional PUT uses the authenticated client (CSRF header, no body fields)", async () => {
    setCsrfToken("csrf-x")
    const { calls } = installFetchMock(() => ok(meBody({ professional: { planCode: "free" } })))
    await createProfessionalProfile()
    expect(calls[0].method).toBe("PUT")
    expect(path(calls[0])).toBe("/users/me/professional-profile")
    expect(calls[0].headers.get("X-CSRF-Token")).toBe("csrf-x")
    expect(calls[0].body).toEqual({})
  })

  it("saved PUT/DELETE encode the listing id and carry no body-field surface", async () => {
    setCsrfToken("csrf-x")
    const { calls } = installFetchMock(() => ok(undefined, 204))
    await saveListing("abc/..def")
    await unsaveListing("abc/..def")
    expect(path(calls[0])).toBe("/saved/abc%2F..def")
    expect(calls[0].method).toBe("PUT")
    expect(path(calls[1])).toBe("/saved/abc%2F..def")
    expect(calls[1].method).toBe("DELETE")
  })

  it("request create sends only writable fields; the server derives the provider from the listing", async () => {
    setCsrfToken("csrf-x")
    const { calls } = installFetchMock(() => ok({}))
    await createRequest({
      providerListingId: "L1",
      service: "Solar install",
      details: "Please quote a 5 kW rooftop system.",
      area: "B-17, Block C",
      preferredDate: "2026-12-01",
      preferredContactChannel: "in_app",
    })
    const body = calls[0].body as Record<string, unknown>
    expect(body.providerListingId).toBe("L1")
    expect(body.preferredContactChannel).toBe("in_app")
    // No "providerId", "status", "providerName", "requesterId" — the backend owns them.
    for (const field of ["providerId", "status", "providerName", "requesterId", "revision"]) {
      expect(body).not.toHaveProperty(field)
    }
  })

  it("request actions hit the four lifecycle paths", async () => {
    setCsrfToken("csrf-x")
    const { calls } = installFetchMock(() => ok({}))
    await actOnRequest("R1", "accept")
    await actOnRequest("R1", "start")
    await actOnRequest("R1", "complete")
    await actOnRequest("R1", "cancel")
    expect(calls.map(path)).toEqual(["/requests/R1/accept", "/requests/R1/start", "/requests/R1/complete", "/requests/R1/cancel"])
  })

  it("listing create carries the kind-discriminated body and a whole location block", async () => {
    setCsrfToken("csrf-x")
    const { calls } = installFetchMock(() => ok({}))
    await createListing({
      kind: "property",
      title: "Flat for rent",
      listingType: "rent",
      propertyType: "flat",
      price: "PKR 50,000 / month",
      description: "A nice flat with two bedrooms and a balcony.",
      area: "B-17",
      tags: [],
      location: { visibility: "exact", latitude: 33.7, longitude: 73.05, address: "Plot 1", block: "B" },
    })
    const body = calls[0].body as Record<string, unknown>
    expect(body.kind).toBe("property")
    expect((body.location as { visibility: string }).visibility).toBe("exact")
  })

  it("listing PATCH carries the current revision (concurrency token)", async () => {
    setCsrfToken("csrf-x")
    const { calls } = installFetchMock(() => ok({}))
    await patchListing("L1", { revision: 7, name: "Renamed" })
    expect(calls[0].method).toBe("PATCH")
    expect((calls[0].body as Record<string, unknown>).revision).toBe(7)
  })

  it("listing archive carries the current revision", async () => {
    setCsrfToken("csrf-x")
    const { calls } = installFetchMock(() => ok({}))
    await archiveListing("L1", 3)
    expect(path(calls[0])).toBe("/listings/L1/archive")
    expect((calls[0].body as Record<string, unknown>).revision).toBe(3)
  })

  it("admin approve / reject carry the current revision; reject includes the reason", async () => {
    setCsrfToken("csrf-x")
    const { calls } = installFetchMock(() => ok({}))
    await approveListing("L1", 5)
    await rejectListing("L1", 5, "Please add the plot size and a clearer description.")
    expect(path(calls[0])).toBe("/admin/listings/L1/approve")
    expect((calls[0].body as Record<string, unknown>).revision).toBe(5)
    const rejectBody = calls[1].body as Record<string, unknown>
    expect(rejectBody.revision).toBe(5)
    expect(rejectBody.reason).toMatch(/plot size/)
  })

  it("category writes: create, patch, reorder; module and slug immutable on patch", async () => {
    setCsrfToken("csrf-x")
    const { calls } = installFetchMock(() => ok({}))
    await createCategory({ module: "directory", name: "New Shop" })
    await patchCategory("C1", { name: "Renamed", isActive: false })
    await reorderCategories({ module: "directory", parentId: null, orderedIds: ["c1", "c2", "c3"] })
    expect(path(calls[0])).toBe("/admin/categories")
    expect(path(calls[1])).toBe("/admin/categories/C1")
    expect(path(calls[2])).toBe("/admin/categories/reorder")
    // `parentId` is required by the backend: the top level is an explicit null, never a missing key.
    expect(calls[2].body).toEqual({ module: "directory", parentId: null, orderedIds: ["c1", "c2", "c3"] })
    const patchBody = calls[1].body as Record<string, unknown>
    // The write-type space makes module / slug unreachable here.
    expect(patchBody).not.toHaveProperty("module")
    expect(patchBody).not.toHaveProperty("slug")
  })

  it("every write is normalised to a typed ApiError (not a thrown envelope)", async () => {
    setCsrfToken("csrf-x")
    installFetchMock(() => fail(409, "listing_conflict", [{ field: "revision", code: "stale_revision", message: "stale" }]))
    const error = await patchListing("L1", { revision: 1 }).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 409, code: "listing_conflict" })
    expect((error as { details: { code?: string }[] }).details[0].code).toBe("stale_revision")
  })
})

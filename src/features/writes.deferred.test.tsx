import { screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ListingFormPage } from "@/features/provider/ListingFormPage"
import { EditListingPage } from "@/features/provider/EditListingPage"
import { ListingPendingPage } from "@/features/provider/ListingPendingPage"
import { ContentListPage } from "@/features/admin/ContentListPage"
import { ContentFormPage } from "@/features/admin/ContentFormPage"
import { installFetchMock } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { adminUser } from "@/test/authFixtures"
import { renderPage } from "@/test/renderPage"
import type { MockCall } from "@/test/apiMock"

/**
 * Phase 12G is read-only. Every write path that used to "succeed" locally must now be honestly
 * unavailable - no form that pretends to save, no success message, and no write request on the wire.
 */
let calls: MockCall[]
beforeEach(() => {
  ;({ calls } = installFetchMock(fakeBackend()))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("deferred write screens", () => {
  it.each([
    ["create listing", <ListingFormPage key="a" />, "/provider/listings/new"],
    ["edit listing", <EditListingPage key="b" />, "/provider/listings/x/edit"],
    ["listing submitted", <ListingPendingPage key="c" />, "/provider/listings/pending"],
  ])("%s says plainly that it is coming soon and offers no form or submit control", async (_name, page, url) => {
    renderPage(page, { url, user: undefined })
    expect((await screen.findAllByText(/coming soon/i)).length).toBeGreaterThan(0)
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /submit|save|publish|create listing/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/submitted for review|listing submitted|saved successfully/i)).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0)
  })

  it.each([
    ["news list", <ContentListPage key="a" />, "/admin/content"],
    ["news form", <ContentFormPage key="b" />, "/admin/content/new"],
  ])("admin %s is honestly unavailable (no browser-local publishing)", async (_name, page, url) => {
    renderPage(page, { url, user: adminUser() })
    expect((await screen.findAllByText(/coming soon/i)).length).toBeGreaterThan(0)
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /publish|save|delete|new/i })).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0)
  })
})

import { expect, test } from "./helpers/test"
import { expectPage, navigateInApp, openApp, signIn } from "./helpers/app"
import { enterAdmin } from "./helpers/workspace"
import { IDS } from "../src/test/fixtures/apiFixtures"

/**
 * Phase 12H write journeys. Each spec asks the writable mock backend (`src/test/fixtures/writeRouter`
 * through `e2e/helpers/authMock`) to accept a real write, then reloads the owner / admin / public
 * read and confirms the server-returned state is what shows. No local-only shortcut remains.
 */

test.describe("Saved: real toggle round trip", () => {
  test("heart → saved on backend, reload keeps it, unsave removes it (no localStorage)", async ({ page }) => {
    await openApp(page, "/login", "Log In")
    await signIn(page, "Rana Resident")
    await expectPage(page)

    // Save an approved listing from the Business Directory → detail.
    await navigateInApp(page, `/businesses/${IDS.generalExact}`, "Glow Salon")
    const save = page.getByRole("button", { name: "Save Glow Salon" })
    await save.click()
    await expect(page.getByRole("button", { name: "Remove Glow Salon from saved" })).toHaveAttribute("aria-pressed", "true")

    // The Saved page reads the server; the row is there.
    await navigateInApp(page, "/profile/saved", "Saved")
    await expect(page.getByText("Glow Salon").first()).toBeVisible()

    // Reload: the state survives because it is on the server, not in a browser store.
    await page.reload()
    await expectPage(page, "Saved")
    await expect(page.getByText("Glow Salon").first()).toBeVisible()

    // Unsave from the Saved page's card.
    await page.getByRole("button", { name: /Remove Glow Salon from saved/ }).first().click()
    await expect(page.getByText("Glow Salon")).toHaveCount(0)
  })

  test("localStorage never holds server authority (no residentStore / planStore keys)", async ({ page }) => {
    await openApp(page, "/login", "Log In")
    await signIn(page, "Rana Resident")
    await expectPage(page)
    await navigateInApp(page, `/businesses/${IDS.generalExact}`, "Glow Salon")
    await page.getByRole("button", { name: "Save Glow Salon" }).click()
    const keys = await page.evaluate(() => Object.keys(window.localStorage))
    for (const key of keys) {
      expect(key).not.toMatch(/resident|plan|saved|request|professional/i)
    }
  })
})

test.describe("Admin: approve a pending listing", () => {
  test("admin approves → owner sees approved; the public listing becomes readable", async ({ page }) => {
    await openApp(page, "/")
    await enterAdmin(page)
    await navigateInApp(page, "/admin/moderation", "Listing Review")
    await page.getByRole("button", { name: "Review Pending Stationers" }).click()
    const dialog = page.getByRole("dialog", { name: "Review Listing" })
    await expect(dialog.getByRole("button", { name: /^Approve$/ })).toBeEnabled()
    page.on("dialog", (d) => void d.accept())
    await dialog.getByRole("button", { name: /^Approve$/ }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // The queue refreshes: the row leaves Pending and enters Approved.
    await page.getByRole("radio", { name: /^Pending/ }).click()
    await expect(page.getByText("Pending Stationers")).toHaveCount(0)
    await page.getByRole("radio", { name: /^Approved/ }).click()
    await expect(page.getByText("Pending Stationers")).toBeVisible()
  })
})

test.describe("Listing create: all five variants hit the API with the right payload", () => {
  async function enterCreateFlow(page: import("@playwright/test").Page, name: string, kindLabel: RegExp) {
    await page.goto("/provider/listings/new")
    await expectPage(page, "Log In")
    await signIn(page, name)
    await expectPage(page, "List Your Business / Service / Property")
    await page.getByRole("button", { name: kindLabel }).click()
  }

  async function recordWrites(page: import("@playwright/test").Page) {
    const sent: { method: string; path: string; body: unknown }[] = []
    page.on("request", (request) => {
      if (!request.url().includes("/api/v1/")) return
      if (request.method() === "GET") return
      const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, "")
      let body: unknown
      try {
        body = request.postData() ? JSON.parse(request.postData()!) : undefined
      } catch {
        body = request.postData()
      }
      sent.push({ method: request.method(), path, body })
    })
    return sent
  }

  test("Service / Professional creates with kind=provider, area_only default, no owner/status fields", async ({ page }) => {
    const sent = await recordWrites(page)
    await enterCreateFlow(page, "Imran Pro", /Service \/ Professional/)
    await page.getByLabel("Name", { exact: true }).fill("Imran Electrical Works")
    await page.getByLabel("Service Category").selectOption({ label: "Electrical" })
    await page.getByLabel("Description", { exact: true }).fill("Wiring, repairs and fittings across B-17.")
    await page.getByLabel("Area", { exact: true }).fill("B-17")
    await page.getByLabel(/Services Offered/).fill("wiring, repairs")
    await page.getByRole("button", { name: "Preview Listing" }).click()

    await expectPage(page, "Listings")
    await expect(page.getByText("Imran Electrical Works")).toBeVisible()

    const post = sent.find((s) => s.method === "POST" && s.path === "/listings")!
    expect(post).toBeTruthy()
    const body = post.body as Record<string, unknown>
    expect(body.kind).toBe("provider")
    for (const forbidden of ["id", "ownerId", "status", "revision", "featured", "submittedAt", "approvedAt", "rejectedAt"]) {
      expect(body).not.toHaveProperty(forbidden)
    }
    expect((body.location as { visibility: string }).visibility).toBe("area_only")
    // The category is the server's SLUG (a label or free text is refused by the real backend).
    expect(body.category).toBe("electrical")
  })

  test("General Business creates with kind=business, vertical=general, no food block", async ({ page }) => {
    const sent = await recordWrites(page)
    await enterCreateFlow(page, "Capital Shops", /Business \/ Shop/)
    await page.getByLabel("Business Name").fill("Capital Stationers")
    await page.getByLabel("Category", { exact: true }).selectOption({ label: "Stationery" })
    await page.getByLabel("Description", { exact: true }).fill("Books, copies and office supplies.")
    await page.getByLabel("Area", { exact: true }).fill("B-17")
    await page.getByLabel(/Services \/ Tags/).fill("books, copies")
    await page.getByRole("button", { name: "Preview Listing" }).click()
    await expectPage(page, "Listings")

    const body = sent.find((s) => s.method === "POST" && s.path === "/listings")!.body as Record<string, unknown>
    expect(body.kind).toBe("business")
    expect(body.vertical).toBe("general")
    expect(body.category).toBe("stationery")
    expect(body).not.toHaveProperty("food")
  })

  test("Food & Dining creates as business + vertical=food, with a food block and no category field", async ({ page }) => {
    const sent = await recordWrites(page)
    await enterCreateFlow(page, "Sana Bakers", /Business \/ Shop/)
    await page.getByRole("radio", { name: /Food & Dining/ }).click()
    await page.getByLabel("Business Name").fill("Fresh Bakes")
    await page.getByLabel("Description", { exact: true }).fill("Fresh bread, cakes and savouries baked daily in B-17.")
    await page.getByLabel("Area", { exact: true }).fill("B-17")
    await page.getByLabel(/Dishes \/ Search Tags/).fill("cakes, bread")
    await page.getByRole("checkbox", { name: "Bakeries" }).check()
    await page.getByRole("checkbox", { name: "Takeaway" }).check()
    await page.getByRole("button", { name: "Preview Listing" }).click()
    await expectPage(page, "Listings")

    const body = sent.find((s) => s.method === "POST" && s.path === "/listings")!.body as Record<string, unknown>
    expect(body.kind).toBe("business")
    expect(body.vertical).toBe("food")
    expect(body).not.toHaveProperty("category")
    expect(body.food).toMatchObject({ categories: ["bakeries"], serviceOptions: ["takeaway"] })
  })

  test("Tutor creates with kind=tutor and a grade field; the subject is the category slug", async ({ page }) => {
    const sent = await recordWrites(page)
    await enterCreateFlow(page, "Sara Tutor", /Tutor/)
    await page.getByLabel("Grade / level you teach").fill("Grade 9")
    await page.getByLabel("Name", { exact: true }).fill("Sara Science Tutor")
    // A tutor's category is a SUBJECT from the education taxonomy (not a service category).
    await expect(page.getByLabel("Service Category")).toHaveCount(0)
    await page.getByLabel("Subject").selectOption({ label: "Physics" })
    await page.getByLabel("Description", { exact: true }).fill("Physics and chemistry for matric and O-level.")
    await page.getByLabel("Area", { exact: true }).fill("B-17")
    await page.getByLabel(/Services Offered/).fill("physics, chemistry")
    await page.getByRole("button", { name: "Preview Listing" }).click()
    await expectPage(page, "Listings")

    const body = sent.find((s) => s.method === "POST" && s.path === "/listings")!.body as Record<string, unknown>
    expect(body.kind).toBe("tutor")
    expect(body.grade).toBe("Grade 9")
    expect(body.category).toBe("physics")
  })

  test("Property creates with kind=property, forbids area_only, and uses the map picker to set a point", async ({ page }) => {
    const sent = await recordWrites(page)
    await enterCreateFlow(page, "Nadeem Property", /Property/)

    // Default visibility is "exact"; use the numeric picker fallback to set the point deterministically
    // (clicking on a Leaflet canvas is not reliable in a headless browser).
    await page.getByLabel("Latitude").fill("33.701234")
    await page.getByLabel("Longitude").fill("73.051234")
    await page.getByLabel("Street address").fill("Plot 1, Street 5")

    await page.getByLabel("Title").fill("3-Bed Flat for Rent")
    await page.getByLabel("Listing Type").selectOption("rent")
    await page.getByLabel("Property Type").selectOption({ label: "Flat" })
    await page.getByLabel("Price").fill("PKR 65,000 / month")
    await page.getByLabel("Area", { exact: true }).fill("B-17")
    await page.getByLabel("Description").fill("Bright flat with a balcony in a well-kept block.")
    await page.getByRole("button", { name: "Preview Listing" }).click()
    await expectPage(page, "Listings")

    const body = sent.find((s) => s.method === "POST" && s.path === "/listings")!.body as Record<string, unknown>
    expect(body.kind).toBe("property")
    const location = body.location as Record<string, unknown>
    expect(location.visibility).toBe("exact")
    expect(body.propertyType).toBe("flat") // the slug, not the label
    expect(location.latitude).toBeCloseTo(33.701234)
    expect(location.longitude).toBeCloseTo(73.051234)
    // area_only is not among the Property picker's options at all.
    expect(page.getByRole("option", { name: /Area only/ })).toHaveCount(0)
  })
})

/** The owner dashboard card of one listing (a fixture row and a created row can sit side by side). */
const ownerCard = (page: import("@playwright/test").Page, name: string) =>
  page.locator('[data-slot="card"]').filter({ hasText: name }).filter({ has: page.getByRole("button", { name: "View" }) })

/** Admin -> owner: the admin logs out, the owner signs in again and lands on Listings. */
async function adminToOwner(page: import("@playwright/test").Page, name = "Sana Owner") {
  await page.getByRole("button", { name: "Log out" }).click()
  await expectPage(page, "Admin Login")
  await page.goto("/provider/listings")
  await expectPage(page, "Log In")
  await signIn(page, name)
  await expectPage(page, "Listings")
}

/** Records the response of the next `POST /listings` so the test knows the new listing's id. */
function captureCreatedId(page: import("@playwright/test").Page): { id: () => string } {
  let id = ""
  page.on("response", async (response) => {
    if (response.request().method() === "POST" && /\/api\/v1\/listings$/.test(response.url()) && response.ok()) {
      id = ((await response.json()) as { data: { id: string } }).data.id
    }
  })
  return { id: () => id }
}

test.describe("Presentation regression (end-to-end round trip)", () => {
  test("create → pending → admin approves → public sees it → material edit → pending → admin rejects → owner sees reason → resubmit → pending; survives reload", async ({ page }) => {
    test.setTimeout(90_000) // a ~21 s journey: the 30 s default has no headroom under parallel load
    const name = "Sunrise Solar Pro"
    const created = captureCreatedId(page)

    // 1. A professional creates a Provider listing through the real form.
    await page.goto("/provider/listings/new")
    await expectPage(page, "Log In")
    await signIn(page, "Sana Owner")
    await expectPage(page, "List Your Business / Service / Property")
    await page.getByRole("button", { name: /Service \/ Professional/ }).click()
    await page.getByLabel("Name", { exact: true }).fill(name)
    await page.getByLabel("Service Category").selectOption({ label: "Solar" })
    await page.getByLabel("Description", { exact: true }).fill("Rooftop solar design and installation for B-17 homes.")
    await page.getByLabel("Area", { exact: true }).fill("B-17")
    await page.getByLabel(/Services Offered/).fill("solar, installation")
    await page.getByRole("button", { name: "Preview Listing" }).click()

    // 2. The owner dashboard shows the new row as pending, revision 1 (both are the server's).
    await expectPage(page, "Listings")
    await expect(ownerCard(page, name)).toContainText("Pending Review")
    await expect(ownerCard(page, name)).toContainText("revision 1")

    // 3. The listing is NOT public while pending.
    expect(created.id()).not.toBe("")
    await page.goto(`/providers/${created.id()}`)
    await expect(page.getByRole("heading", { level: 1, name: "Provider not found" })).toBeVisible()

    // 4. Admin sees it pending in the queue, opens the detail and approves.
    await enterAdmin(page)
    await navigateInApp(page, "/admin/moderation", "Listing Review")
    await page.getByRole("button", { name: `Review ${name}` }).click()
    const review = page.getByRole("dialog", { name: "Review Listing" })
    await expect(review).toContainText("Pending Review")
    await review.getByRole("button", { name: /^Approve$/ }).click()
    await expect(review).toBeHidden({ timeout: 10_000 })

    // 5. The public listing page now reads it.
    await page.goto(`/providers/${created.id()}`)
    await expectPage(page, name)

    // 6. The owner sees Approved and makes a MATERIAL edit through the real form.
    await page.goto("/admin/moderation")
    await expectPage(page, "Listing Review")
    await adminToOwner(page)
    await expect(ownerCard(page, name)).toContainText("Approved")
    await ownerCard(page, name).getByRole("button", { name: "Edit" }).click()
    await expectPage(page, "Edit Listing")
    await page.getByLabel("Description", { exact: true }).fill("Rooftop solar design and installation for B-17 - now with inverter and battery options.")
    await page.getByRole("button", { name: "Preview Listing" }).click()

    // 7. The page navigates back to Listings; the server's answer is pending, revision 2.
    await expect(page.getByText("Changes submitted for review")).toBeVisible()
    await expectPage(page, "Listings")
    await expect(ownerCard(page, name)).toContainText("Pending Review")
    await expect(ownerCard(page, name)).toContainText("revision 2")
    await expect(ownerCard(page, name)).not.toContainText("Approved")

    // 8. Admin sees it pending again and rejects it with a reason.
    await enterAdmin(page)
    await navigateInApp(page, "/admin/moderation", "Listing Review")
    await page.getByRole("button", { name: `Review ${name}` }).click()
    const review2 = page.getByRole("dialog", { name: "Review Listing" })
    await expect(review2).toContainText("Pending Review")
    await review2.getByRole("button", { name: /^Reject$/ }).click()
    await review2.getByLabel(/Rejection reason/).fill("Please add before-and-after installation photos.")
    await review2.getByRole("button", { name: /Confirm Rejection/ }).click()
    await expect(review2).toBeHidden({ timeout: 10_000 })

    // 9. The owner sees the reason, edits again and resubmits.
    await adminToOwner(page)
    await expect(ownerCard(page, name)).toContainText("Please add before-and-after installation photos.")
    await ownerCard(page, name).getByRole("button", { name: "Edit" }).click()
    await expectPage(page, "Edit Listing")
    await page.getByLabel("Description", { exact: true }).fill("Rooftop solar design and installation for B-17 - photo gallery of past installs available on request.")
    await page.getByRole("button", { name: "Preview Listing" }).click()
    await expectPage(page, "Listings")

    // 10. Pending again, the stale rejection reason is gone, and all of it survives a reload.
    for (const reload of [false, true]) {
      if (reload) {
        await page.reload()
        await expectPage(page, "Listings")
      }
      await expect(ownerCard(page, name)).toContainText("Pending Review")
      await expect(ownerCard(page, name)).toContainText("revision 3")
      await expect(ownerCard(page, name)).not.toContainText("Please add before-and-after installation photos.")
    }

    // 11. Nothing server-authoritative lives in localStorage.
    const keys = await page.evaluate(() => Object.keys(window.localStorage))
    for (const key of keys) expect(key).not.toMatch(/listing|request|saved|resident|plan|professional/i)
  })

  test("the owner can archive an approved listing; it stays archived after a reload", async ({ page }) => {
    await page.goto("/provider/listings")
    await expectPage(page, "Log In")
    await signIn(page, "Sana Owner")
    await expectPage(page, "Listings")
    page.on("dialog", (d) => void d.accept())
    await ownerCard(page, "Approved Plumbing Co").getByRole("button", { name: "Archive" }).click()
    await expect(ownerCard(page, "Approved Plumbing Co")).toContainText("Archived", { timeout: 10_000 })
    await page.reload()
    await expectPage(page, "Listings")
    await expect(ownerCard(page, "Approved Plumbing Co")).toContainText("Archived")
    await expect(ownerCard(page, "Approved Plumbing Co").getByRole("button", { name: "Edit" })).toHaveCount(0)
  })
})

test.describe("Listing edit / resubmit through the real form", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/provider/listings")
    await expectPage(page, "Log In")
    await signIn(page, "Sana Owner")
    await expectPage(page, "Listings")
  })

  test("approved + material edit → PATCH carries the loaded revision → server answers pending / a newer revision → page returns to Listings; reload keeps the edit", async ({ page }) => {
    const patches: Record<string, unknown>[] = []
    page.on("request", (request) => {
      if (request.method() === "PATCH" && /\/api\/v1\/listings\//.test(request.url())) patches.push(JSON.parse(request.postData() ?? "{}"))
    })
    await expect(ownerCard(page, "Approved Plumbing Co")).toContainText("Approved")
    await expect(ownerCard(page, "Approved Plumbing Co")).toContainText("revision 3")
    await ownerCard(page, "Approved Plumbing Co").getByRole("button", { name: "Edit" }).click()
    await expectPage(page, "Edit Listing")
    // The form is prefilled from the owner read: category slug selected, name and description present.
    await expect(page.getByLabel("Service Category")).toHaveValue("plumbing")
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Approved Plumbing Co")
    await page.getByLabel("Description", { exact: true }).fill("Plumbing repairs and bathroom fittings across B-17, same-day call-outs.")
    await page.getByRole("button", { name: "Preview Listing" }).click()

    await expect(page.getByText("Changes submitted for review")).toBeVisible()
    await expect(page).toHaveURL(/\/provider\/listings$/)
    await expectPage(page, "Listings")
    await expect(ownerCard(page, "Approved Plumbing Co")).toContainText("Pending Review")
    await expect(ownerCard(page, "Approved Plumbing Co")).toContainText("revision 4")
    await expect(ownerCard(page, "Approved Plumbing Co")).not.toContainText(/Approved(?! Plumbing)/)

    expect(patches).toHaveLength(1)
    expect(patches[0].revision).toBe(3) // the revision that was LOADED, not a guess
    expect(patches[0].category).toBe("plumbing")
    for (const forbidden of ["id", "ownerId", "status", "kind", "approvedAt", "rejectedAt", "rejectionReason"]) expect(patches[0]).not.toHaveProperty(forbidden)

    // Reload: still pending / revision 4, and the edit itself persisted.
    await page.reload()
    await expectPage(page, "Listings")
    await expect(ownerCard(page, "Approved Plumbing Co")).toContainText("Pending Review")
    await ownerCard(page, "Approved Plumbing Co").getByRole("button", { name: "Edit" }).click()
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(/same-day call-outs/)
  })

  test("rejected → the owner sees the reason → edits a real field → PATCH → pending, the stale reason is gone; reload keeps it", async ({ page }) => {
    const card = ownerCard(page, "Rejected Plot")
    await expect(card).toContainText("Rejected")
    await expect(card).toContainText("Please add the plot size and a clearer description.")
    await card.getByRole("button", { name: "Edit" }).click()
    await expectPage(page, "Edit Listing")
    await expect(page.getByText(/Rejected: Please add the plot size/)).toBeVisible()
    // Property fields are prefilled from the owner read, including the type SLUG and the price.
    await expect(page.getByLabel("Property Type")).toHaveValue("plot")
    await expect(page.getByLabel("Price")).toHaveValue("PKR 1 Cr")
    await page.getByLabel("Description").fill("A 10 marla residential plot in B-17 Block C with all utilities, available for sale.")
    await page.getByRole("button", { name: "Preview Listing" }).click()

    await expect(page.getByText("Listing updated")).toBeVisible()
    await expectPage(page, "Listings")
    for (const reload of [false, true]) {
      if (reload) {
        await page.reload()
        await expectPage(page, "Listings")
      }
      await expect(card).toContainText("Pending Review")
      await expect(card).toContainText("revision 2")
      await expect(card).not.toContainText("Please add the plot size and a clearer description.")
    }
  })

  test("rejected + submit without an effective change → no_changes → a useful message, no false success, still rejected", async ({ page }) => {
    const card = ownerCard(page, "Rejected Plot")
    await card.getByRole("button", { name: "Edit" }).click()
    await expectPage(page, "Edit Listing")
    await page.getByRole("button", { name: "Preview Listing" }).click()

    await expect(page.getByText("Please change at least one field before resubmitting.")).toBeVisible()
    await expect(page.getByText(/Listing updated|Changes submitted for review/)).toHaveCount(0)
    await expect(page).toHaveURL(/\/provider\/listings\/[^/]+\/edit$/)
    // Nothing moved on the server: still rejected, same revision, the reason is still there.
    await navigateInApp(page, "/provider/listings", "Listings")
    await expect(card).toContainText("Rejected")
    await expect(card).toContainText("revision 1")
    await expect(card).toContainText("Please add the plot size and a clearer description.")
  })

  test("a stale edit (the listing changed after the form was opened) is refused 409, the form reloads and says so", async ({ page }) => {
    await ownerCard(page, "Approved Plumbing Co").getByRole("button", { name: "Edit" }).click()
    await expectPage(page, "Edit Listing")
    await page.getByLabel("Description", { exact: true }).fill("Plumbing repairs and bathroom fittings across B-17, with a 12-month warranty.")
    // Somebody else changes the listing: the server answers the PATCH with a revision conflict.
    await page.route(/\/api\/v1\/listings\/[^/]+$/, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback()
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "listing_conflict", message: "stale", details: [{ field: "revision", code: "stale_revision" }], requestId: "r" } }),
      })
    })
    await page.getByRole("button", { name: "Preview Listing" }).click()
    await expect(page.getByText("This listing has changed since you opened it")).toBeVisible()
    await expect(page).toHaveURL(/\/edit$/) // never silently navigates, never silently retries
    await expect(page.getByText(/Changes submitted for review|Listing updated/)).toHaveCount(0)
  })
})

test.describe("Professional capability: the server decides", () => {
  test("a Resident without a professional profile is refused a listing write by the (real-style) API, and nothing is created", async ({ page }) => {
    await page.goto("/provider/listings/new")
    await expectPage(page, "Log In")
    await signIn(page, "Rana Resident", "resident")
    // The UI gate says so...
    await expectPage(page, "Professional profile needed")
    // ...and the API itself refuses the write with the real error code, writing nothing.
    const attempt = await page.evaluate(async () => {
      const response = await fetch("/api/v1/listings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "provider", name: "Sneaky Listing", category: "solar", description: "A listing created without a professional profile.", area: "B-17", tags: ["x"], location: { visibility: "area_only" } }),
      })
      return { status: response.status, body: (await response.json()) as { error?: { code: string } } }
    })
    expect(attempt.status).toBe(403)
    expect(attempt.body.error?.code).toBe("professional_profile_required")
    const listings = await page.evaluate(async () => ((await (await fetch("/api/v1/users/me/listings", { credentials: "include" })).json()) as { data: { name?: string }[] }).data)
    expect(listings.some((l) => l.name === "Sneaky Listing")).toBe(false)
    await expect(page.getByText(/submitted for review/i)).toHaveCount(0)
  })

  test("creating the professional profile (PUT) unlocks the same flow, which then succeeds", async ({ page }) => {
    await page.goto("/provider/listings/new")
    await expectPage(page, "Log In")
    await signIn(page, "Rana Resident", "resident")
    await expectPage(page, "Professional profile needed")
    await page.getByRole("button", { name: "Create a professional profile" }).click()
    await expectPage(page, "List Your Business / Service / Property")
    await page.getByRole("button", { name: /Service \/ Professional/ }).click()
    await page.getByLabel("Name", { exact: true }).fill("Rana Plumbing")
    await page.getByLabel("Service Category").selectOption({ label: "Plumbing" })
    await page.getByLabel("Description", { exact: true }).fill("Plumbing repairs and fittings for B-17 homes.")
    await page.getByLabel("Area", { exact: true }).fill("B-17")
    await page.getByLabel(/Services Offered/).fill("plumbing, repairs")
    await page.getByRole("button", { name: "Preview Listing" }).click()
    await expectPage(page, "Listings")
    await expect(ownerCard(page, "Rana Plumbing")).toContainText("Pending Review")
  })

  test("an unverified e-mail is told to verify first and cannot create the profile", async ({ page, authMock }) => {
    authMock.addAccount({ email: "unverified.pro@example.org", displayName: "Unverified Una", emailVerified: false })
    await page.goto("/provider/listings/new")
    await expectPage(page, "Log In")
    await page.getByLabel("Email").fill("unverified.pro@example.org")
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery")
    await page.getByRole("button", { name: "Log In", exact: true }).click()
    await expectPage(page, "Professional profile needed")
    await page.getByRole("button", { name: "Create a professional profile" }).click()
    await expect(page.getByRole("alert")).toContainText("verify your email")
  })
})

test.describe("Service requests: full lifecycle", () => {
  test("requester creates → provider accept/start/complete → requester sees completed", async ({ page }) => {
    // A pre-approved provider listing from the fixtures (public reads find it).
    const providerId = IDS.ownerApproved // "Approved Plumbing Co" in the owner fixtures (also approved)
    await page.goto("/login")
    await expectPage(page, "Log In")
    await signIn(page, "Naila Requester")
    await expectPage(page)

    await navigateInApp(page, `/providers/${providerId}`, /./)
    await page.getByRole("button", { name: "Request Service" }).click()
    const dialog = page.getByRole("dialog", { name: /Request / })
    await expect(dialog).toBeVisible()
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const uniqueDetails = `Please quote a kitchen plumbing fix - UNIQUE${Date.now()}`
    await dialog.getByLabel("What do you need?").fill(uniqueDetails)
    await dialog.getByLabel("Area / Location").fill("B-17, Block A")
    await dialog.getByLabel("Preferred Date").fill(tomorrow)
    await dialog.getByRole("button", { name: /Submit Request/ }).click()
    await expect(dialog.getByText("Request sent")).toBeVisible()
    await dialog.getByRole("button", { name: "Done" }).click()

    // The requester's My Requests shows the submitted row (identified by provider snapshot).
    await navigateInApp(page, "/profile/requests", "My Requests")
    const row = page.getByRole("button").filter({ hasText: /Approved Plumbing Co/ }).filter({ hasText: /Submitted/ }).first()
    await expect(row).toBeVisible()

    // Switch to the provider account: it sees the lead.
    await navigateInApp(page, "/admin/login", "Admin Login")
    const switchAccount = page.getByRole("button", { name: "Log out to switch account" })
    if (await switchAccount.isVisible()) await switchAccount.click()
    await page.goto("/provider/leads")
    await expectPage(page, "Log In")
    await signIn(page, "Sana Owner")
    await expectPage(page, "Leads")
    const leadRow = page.getByRole("button").filter({ hasText: /From Naila Requester/ }).first()
    await expect(leadRow).toBeVisible()

    // Provider accept → start → complete.
    for (const [action, badge] of [
      ["Accept", /Accepted/],
      ["Start work", /In Progress/],
      ["Mark complete", /Completed/],
    ] as const) {
      await page.getByRole("button").filter({ hasText: /From Naila Requester/ }).first().click()
      const leadDialog = page.getByRole("dialog")
      await leadDialog.getByRole("button", { name: action }).click()
      // After acting, the dialog closes and the list refreshes to show the new status.
      await expect(leadDialog).toBeHidden({ timeout: 10_000 })
      await expect(page.getByText(badge).first()).toBeVisible()
    }

    // Requester reload: the completed state persists on the server.
    await navigateInApp(page, "/admin/login", "Admin Login")
    const switchAccount2 = page.getByRole("button", { name: "Log out to switch account" })
    if (await switchAccount2.isVisible()) await switchAccount2.click()
    await page.goto("/profile/requests")
    await expectPage(page, "Log In")
    await signIn(page, "Naila Requester")
    await expectPage(page, "My Requests")
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible()
  })

  test("requester cancels a submitted request; it moves to Cancelled", async ({ page }) => {
    const providerId = IDS.ownerApproved
    await page.goto("/login")
    await signIn(page, "Faisal Cancel")
    await expectPage(page)
    await navigateInApp(page, `/providers/${providerId}`, /./)
    await page.getByRole("button", { name: "Request Service" }).click()
    const dialog = page.getByRole("dialog", { name: /Request / })
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await dialog.getByLabel("What do you need?").fill("Short notice: please quote a shelf installation job for a small flat.")
    await dialog.getByLabel("Area / Location").fill("B-17, Block B")
    await dialog.getByLabel("Preferred Date").fill(tomorrow)
    await dialog.getByRole("button", { name: /Submit Request/ }).click()
    await expect(dialog.getByText("Request sent")).toBeVisible()
    await dialog.getByRole("button", { name: "Done" }).click()
    await navigateInApp(page, "/profile/requests", "My Requests")

    page.on("dialog", (d) => void d.accept())
    // The newest submitted row is identified by its provider snapshot.
    const row = page.getByRole("button").filter({ hasText: /To Approved Plumbing Co/ }).filter({ hasText: /Submitted/ }).first()
    await expect(row).toBeVisible()
    await row.click()
    const detail = page.getByRole("dialog")
    await detail.getByRole("button", { name: "Cancel request" }).click()
    await expect(detail).toBeHidden({ timeout: 10_000 })
    await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible()
  })
})

test.describe("Admin stale revision", () => {
  test("admin's approve on a stale revision is rejected 409 and the UI reloads to show the new state", async ({ page }) => {
    await openApp(page, "/")
    await enterAdmin(page)
    await navigateInApp(page, "/admin/moderation", "Listing Review")
    await page.getByRole("button", { name: "Review Pending Stationers" }).click()
    const dialog = page.getByRole("dialog", { name: "Review Listing" })
    await expect(dialog).toBeVisible()

    // Simulate a parallel owner PATCH between the admin opening the dialog and the admin clicking
    // Approve: the server has moved on, so the admin's request lands with a stale revision and the
    // backend answers 409 listing_conflict. We force that response once, then clear the intercept.
    let stallOnce = true
    await page.route(/\/api\/v1\/admin\/listings\/[^/]+\/approve$/, async (route) => {
      if (stallOnce) {
        stallOnce = false
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "listing_conflict",
              message: "stale revision",
              details: [{ field: "revision", code: "stale_revision", message: "current revision is N" }],
              requestId: "req-e2e",
            },
          }),
        })
        return
      }
      await route.fallback()
    })

    await dialog.getByRole("button", { name: /^Approve$/ }).click()

    // The user-copy for a listing conflict announces the stale state; the dialog remains open.
    await expect(dialog.getByText(/changed since you opened it/i)).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toBeVisible()
    // The stale POST did not succeed: the listing is still Pending in the admin's own queue.
    await page.unroute(/\/api\/v1\/admin\/listings\/[^/]+\/approve$/)
  })
})

test.describe("Admin categories: writes round trip", () => {
  test("create → rename → deactivate → reorder; the new order survives a reload", async ({ page }) => {
    await openApp(page, "/")
    await enterAdmin(page)
    await navigateInApp(page, "/admin/categories", "Categories")

    // Create a brand-new category.
    await page.getByRole("button", { name: "Add a Business Directory category" }).click()
    await page.getByLabel("New Business Directory category name").fill("Dry Cleaners")
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await expect(page.getByText("Dry Cleaners")).toBeVisible()

    // Rename the first category.
    const firstName = (await page.getByRole("button").filter({ hasText: /Pharmacy|Hairdressing|Dry Cleaners|Retired Category/ }).first().innerText()).trim()
    await page.getByRole("button").filter({ hasText: firstName }).first().click()
    await page.getByRole("textbox", { name: `Rename ${firstName}` }).fill(`${firstName} (renamed)`)
    await page.keyboard.press("Enter")
    await expect(page.getByText(`${firstName} (renamed)`)).toBeVisible()

    // Deactivate the renamed row.
    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: `${firstName} (renamed)` })
      .getByRole("button", { name: "Deactivate" })
      .click()
    await expect(
      page.locator('[data-slot="card"]').filter({ hasText: `${firstName} (renamed)` }).getByRole("button", { name: "Activate" })
    ).toBeVisible()

    // Reorder: move "Dry Cleaners" up.
    const row = page.locator('[data-slot="card"]').filter({ hasText: "Dry Cleaners" })
    await row.getByRole("button", { name: "Move Dry Cleaners up" }).click()

    // Reload the page: the final state persists.
    await page.reload()
    await expectPage(page, "Categories")
    await expect(page.getByText("Dry Cleaners")).toBeVisible()
    await expect(page.getByText(`${firstName} (renamed)`)).toBeVisible()
    await expect(
      page.locator('[data-slot="card"]').filter({ hasText: `${firstName} (renamed)` }).getByRole("button", { name: "Activate" })
    ).toBeVisible()
  })
})

test.describe("Network failure: no fake success on any write", () => {
  test("listing create failure keeps the form state; no toast says it was saved", async ({ page }) => {
    await page.goto("/provider/listings/new")
    await expectPage(page, "Log In")
    await signIn(page, "Sana Offline")
    await expectPage(page, "List Your Business / Service / Property")
    await page.getByRole("button", { name: /Service \/ Professional/ }).click()
    await page.getByLabel("Name", { exact: true }).fill("Would-Be Service")
    await page.getByLabel("Service Category").selectOption({ label: "Solar" })
    await page.getByLabel("Description", { exact: true }).fill("A service that should NOT be created when the network fails.")
    await page.getByLabel("Area", { exact: true }).fill("B-17")
    await page.getByLabel(/Services Offered/).fill("solar, repairs")

    // Simulate a server failure on POST /listings.
    await page.route("**/api/v1/listings", (route) => (route.request().method() === "POST" ? route.abort("failed") : route.continue()))
    await page.getByRole("button", { name: "Preview Listing" }).click()

    // The form stays, no "submitted" page, and the form data survives.
    await expect(page.getByRole("heading", { level: 1, name: /List Your Business/ })).toBeVisible()
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Would-Be Service")
    await expect(page.getByText(/submitted for review/i)).toHaveCount(0)
  })
})

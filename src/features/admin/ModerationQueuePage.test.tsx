import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ModerationQueuePage } from "@/features/admin/ModerationQueuePage"
import { toAdminQueueRow } from "@/lib/api/ownerAdapters"
import type { AdminListingSummaryDto } from "@/lib/api/dto/private"
import { installFetchMock, meBody, okPage } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { adminUser } from "@/test/authFixtures"
import { renderPage } from "@/test/renderPage"

/**
 * The moderation queue (S5A): a row says "Taken down" for a listing a moderator removed after it was live and
 * "Rejected" for one refused while pending - the same derived `takenDown` marker the review dialog uses, so the two
 * cannot disagree. Both share the one status (`rejected`), the one filter and the one count.
 */
afterEach(() => vi.unstubAllGlobals())

const row = (over: Partial<AdminListingSummaryDto> & { id: string; title: string }): AdminListingSummaryDto => ({
  kind: "provider",
  area: "B-17",
  locationVisibility: "area_only",
  categoryLabel: "Plumbing",
  status: "pending",
  revision: 1,
  submittedAt: "2026-10-05T08:00:00Z",
  updatedAt: "2026-10-06T08:00:00Z",
  submitter: { displayName: "Sana Owner" },
  ...over,
})

const ROWS: AdminListingSummaryDto[] = [
  row({ id: "00000000-0000-4000-8000-0000000000b1", title: "Queue Takedown", status: "rejected", takenDown: true }),
  row({ id: "00000000-0000-4000-8000-0000000000b2", title: "Queue Rejection", status: "rejected" }),
  row({ id: "00000000-0000-4000-8000-0000000000b3", title: "Queue Pending" }),
  row({ id: "00000000-0000-4000-8000-0000000000b4", title: "Queue Live", status: "approved" }),
]
const COUNTS = { pending: 1, approved: 1, rejected: 2, archived: 0 }

function openQueue(rows: AdminListingSummaryDto[] = ROWS) {
  installFetchMock(
    fakeBackend({
      me: meBody({ roles: ["admin"] }),
      overrides: {
        "/admin/listings": (call) => {
          const status = new URL(call.url, "http://test.invalid").searchParams.get("status")
          return okPage(
            rows.filter((r) => !status || r.status === status),
            { counts: COUNTS }
          )
        },
      },
    })
  )
  renderPage(<ModerationQueuePage />, { url: "/admin/moderation", user: adminUser() })
}

/** The queue row (the card) that holds a listing's Review button. */
function rowOf(title: string): HTMLElement {
  const card = screen.getByRole("button", { name: `Review ${title}` }).closest('[data-slot="card"]')
  if (!(card instanceof HTMLElement)) throw new Error(`no queue row for ${title}`)
  return card
}

describe("the queue row", () => {
  it("says Taken down for a takedown and Rejected for a plain rejection (the row itself, not only the dialog)", async () => {
    openQueue()
    await screen.findByText("Queue Takedown")
    expect(within(rowOf("Queue Takedown")).getByText("Taken down")).toBeInTheDocument()
    expect(within(rowOf("Queue Takedown")).queryByText("Rejected")).not.toBeInTheDocument()
    expect(within(rowOf("Queue Rejection")).getByText("Rejected")).toBeInTheDocument()
    expect(within(rowOf("Queue Rejection")).queryByText("Taken down")).not.toBeInTheDocument()
  })

  it("leaves every other status alone", async () => {
    openQueue()
    await screen.findByText("Queue Pending")
    expect(within(rowOf("Queue Pending")).getByText("Pending Review")).toBeInTheDocument()
    expect(within(rowOf("Queue Live")).getByText("Approved")).toBeInTheDocument()
    expect(within(rowOf("Queue Live")).queryByText("Taken down")).not.toBeInTheDocument()
  })

  it("keeps both under the one Rejected filter and count (the status, the filter and the history are unchanged)", async () => {
    const user = userEvent.setup()
    openQueue()
    await screen.findByText("Queue Takedown")
    expect(screen.getByRole("radio", { name: "Rejected (2)" })).toBeInTheDocument()
    await user.click(screen.getByRole("radio", { name: /^Rejected/ }))
    await waitFor(() => expect(screen.queryByText("Queue Pending")).not.toBeInTheDocument())
    expect(within(rowOf("Queue Takedown")).getByText("Taken down")).toBeInTheDocument()
    expect(within(rowOf("Queue Rejection")).getByText("Rejected")).toBeInTheDocument()
  })

  it("the review dialog opens with the same label the row had, before the full listing has loaded", async () => {
    const user = userEvent.setup()
    openQueue()
    await screen.findByText("Queue Takedown")
    await user.click(screen.getByRole("button", { name: "Review Queue Takedown" }))
    const dialog = await screen.findByRole("dialog", { name: "Review Listing" })
    // The detail read is the fake backend's 404 here: the dialog still shows the row's own status, not "Rejected".
    expect(within(dialog).getByText("Taken down")).toBeInTheDocument()
    expect(within(dialog).queryByText("Rejected")).not.toBeInTheDocument()
  })
})

describe("the adapter", () => {
  it("keeps the marker only on a rejected row", () => {
    expect(toAdminQueueRow(ROWS[0]!).takenDown).toBe(true)
    expect(toAdminQueueRow(ROWS[1]!).takenDown).toBeUndefined()
    // Never trusted on a row that is not rejected.
    expect(toAdminQueueRow({ ...ROWS[0]!, status: "pending" }).takenDown).toBeUndefined()
    expect(toAdminQueueRow({ ...ROWS[0]!, status: "approved" }).takenDown).toBeUndefined()
  })
})

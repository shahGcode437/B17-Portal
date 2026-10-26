import { MemoryRouter } from "react-router-dom"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Wrench } from "lucide-react"
import { describe, expect, it, vi } from "vitest"
import { ResultPreviewDialog } from "@/components/overlay/ResultPreviewDialog"
import { LocationProbe } from "@/test/LocationProbe"
import type { SearchResult } from "@/types/search"

/**
 * The preview dialog has ONE action: open the real detail page. It never offers a Contact / WhatsApp
 * button and never shows "simulated" copy, whatever the result kind (Phase 12S).
 */
const result = (kind: SearchResult["kind"]): SearchResult => ({
  kind,
  id: "abc",
  title: "Something Local",
  subtitle: "Category",
  description: "A short description of the thing.",
  area: "B-17",
  icon: Wrench,
  tags: ["one", "two"],
})

const cases: [SearchResult["kind"], string, string][] = [
  ["provider", "View Profile", "/providers/abc"],
  ["business", "View Profile", "/businesses/abc"],
  ["tutor", "View Profile", "/tutors/abc"],
  ["property", "View Details", "/properties/abc"],
  ["news", "Read More", "/news/abc"],
]

describe("ResultPreviewDialog", () => {
  it.each(cases)("%s: a single honest primary action that opens the detail page", async (kind, label, destination) => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <ResultPreviewDialog result={result(kind)} onOpenChange={onOpenChange} />
        <LocationProbe />
      </MemoryRouter>
    )
    expect(screen.queryByRole("button", { name: /whatsapp|contact/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/simulated|later phase|prototype/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: label }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByTestId("location")).toHaveTextContent(destination)
  })
})

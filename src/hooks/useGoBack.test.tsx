import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { afterEach, describe, expect, it } from "vitest"
import { useGoBack } from "@/hooks/useGoBack"

function Detail() {
  const goBack = useGoBack("/services")
  return (
    <button type="button" onClick={goBack}>
      Back
    </button>
  )
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function setup(entries: string[], index: number) {
  render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes>
        <Route path="/providers/:id" element={<Detail />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

describe("useGoBack: the Back button of a detail page", () => {
  afterEach(() => window.history.replaceState(null, ""))

  it("goes back to the earlier page of this app when there is one", async () => {
    window.history.replaceState({ idx: 2 }, "") // React Router's own entry index: this is not the first entry
    setup(["/search?q=solar", "/providers/p-1"], 1)
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByTestId("where")).toHaveTextContent("/search")
  })

  it("on a deep link (first entry) goes to the page's own section instead of doing nothing", async () => {
    window.history.replaceState({ idx: 0 }, "")
    setup(["/providers/p-1"], 0)
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByTestId("where")).toHaveTextContent("/services")
  })

  it("without a history index at all, it still has somewhere to go", async () => {
    window.history.replaceState(null, "")
    setup(["/providers/p-1"], 0)
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByTestId("where")).toHaveTextContent("/services")
  })
})

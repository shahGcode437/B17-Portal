import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FilterControls } from "@/components/inputs/FilterControls"
import { resetCategoryCache } from "@/hooks/useCategories"
import { installFetchMock } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import type { SearchFilters, SearchResultKind } from "@/types/search"

// Category and area options come from the (fake) backend: nothing is hard-coded in the component.
let calls: ReturnType<typeof installFetchMock>["calls"]
beforeEach(() => {
  resetCategoryCache()
  ;({ calls } = installFetchMock(fakeBackend()))
})

function setup(props: { type?: SearchResultKind | "all"; filters?: SearchFilters; showClear?: boolean } = {}) {
  const handlers = {
    onTypeChange: vi.fn(),
    onFiltersChange: vi.fn(),
    onSortChange: vi.fn(),
    onClear: vi.fn(),
  }
  render(
    <FilterControls
      type={props.type ?? "business"}
      filters={props.filters ?? {}}
      sort="default"
      showClear={props.showClear ?? false}
      {...handlers}
    />
  )
  return handlers
}

describe("FilterControls", () => {
  it("offers a content-type filter group and reports a type change", async () => {
    const user = userEvent.setup()
    const { onTypeChange } = setup({ type: "all" })
    const group = screen.getByRole("radiogroup", { name: /content type/i })
    expect(group).toBeInTheDocument()
    await user.click(screen.getByRole("radio", { name: "Property" }))
    expect(onTypeChange).toHaveBeenCalledWith("property")
  })

  it("shows the General Directory filters (Business Type, Category) by default for businesses", () => {
    setup({ type: "business" })
    expect(screen.getByRole("combobox", { name: "Business Type" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Category" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Food Category" })).not.toBeInTheDocument()
  })

  it("switching to Food & Dining resets the dependent filters and reports vertical=food", async () => {
    const user = userEvent.setup()
    const { onFiltersChange } = setup({ type: "business", filters: { category: "Pharmacy", area: "B-17, Block A (Demo Area)" } })
    await user.selectOptions(screen.getByRole("combobox", { name: "Business Type" }), "food")
    const next = onFiltersChange.mock.calls[0][0] as SearchFilters
    expect(next.vertical).toBe("food")
    expect(next.category).toBeUndefined() // the General category value space does not carry over
    expect(next.foodCategory).toBeUndefined()
    expect(next.service).toBeUndefined()
    expect(next.area).toBe("B-17, Block A (Demo Area)") // area is shared and kept
  })

  it("in Food scope shows Food Category + Service (with the 'Delivery by the business' wording) instead of Category", async () => {
    setup({ type: "business", filters: { vertical: "food" } })
    expect(screen.getByRole("combobox", { name: "Food Category" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Service" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Category" })).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Delivery by the business" })).toBeInTheDocument()
    // The Food categories are the server's (`GET /categories?module=food`), not a hard-coded list.
    expect(await screen.findByRole("option", { name: "Bakeries" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Sweets / Desserts" })).toBeInTheDocument()
    expect(calls.map((c) => c.path + new URL(c.url, "http://x").search)).toContain("/categories?module=food")
    // ...and General categories are not requested while the Food scope is showing.
    expect(calls.some((c) => c.url.includes("module=directory"))).toBe(false)
  })

  it("offers the General categories from the server, and never an inactive one", async () => {
    setup({ type: "business" })
    expect(await screen.findByRole("option", { name: "Pharmacy" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Hairdressing" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Retired Category" })).not.toBeInTheDocument()
  })

  it("offers no Area or Grade dropdown: their values are not enumerable, so none is invented from a page of results", async () => {
    for (const type of ["provider", "business", "tutor", "property"] as const) {
      const { unmount } = render(
        <FilterControls type={type} filters={{}} sort="default" showClear={false} onTypeChange={vi.fn()} onFiltersChange={vi.fn()} onSortChange={vi.fn()} onClear={vi.fn()} />
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(screen.queryByRole("combobox", { name: "Area" })).not.toBeInTheDocument()
      expect(screen.queryByRole("combobox", { name: "Grade" })).not.toBeInTheDocument()
      unmount()
    }
    // And no request that could have been used to build such a list (the old lookup asked for 50 hits).
    expect(calls.filter((c) => c.path === "/search")).toEqual([])
  })

  it("reports a Food category and a service choice", async () => {
    const user = userEvent.setup()
    const { onFiltersChange } = setup({ type: "business", filters: { vertical: "food" } })
    await screen.findByRole("option", { name: "Bakeries" })
    await user.selectOptions(screen.getByRole("combobox", { name: "Food Category" }), "bakeries")
    expect(onFiltersChange).toHaveBeenLastCalledWith({ vertical: "food", foodCategory: "bakeries" })
    await user.selectOptions(screen.getByRole("combobox", { name: "Service" }), "delivery")
    expect(onFiltersChange).toHaveBeenLastCalledWith({ vertical: "food", service: "delivery" })
  })

  it("hides the clear action when nothing is filtered", () => {
    const hidden = setup({ showClear: false })
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument()
    expect(hidden.onClear).not.toHaveBeenCalled()
  })

  it("calls onClear from the clear button when filters are active", async () => {
    const user = userEvent.setup()
    const { onClear } = setup({ filters: { vertical: "food" }, showClear: true })
    await user.click(screen.getByRole("button", { name: /clear/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

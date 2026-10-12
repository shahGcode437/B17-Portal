import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { FilterControls } from "@/components/inputs/FilterControls"
import type { SearchFilters, SearchResultKind } from "@/types/search"

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

  it("shows the General Directory filters (Business Type, Category, Area) by default for businesses", () => {
    setup({ type: "business" })
    expect(screen.getByRole("combobox", { name: "Business Type" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Category" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Area" })).toBeInTheDocument()
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

  it("in Food scope shows Food Category + Service (with the 'Delivery by the business' wording) instead of Category", () => {
    setup({ type: "business", filters: { vertical: "food" } })
    expect(screen.getByRole("combobox", { name: "Food Category" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Service" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Category" })).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Delivery by the business" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Biryani / Rice" })).toBeInTheDocument()
  })

  it("reports a Food category and a service choice", async () => {
    const user = userEvent.setup()
    const { onFiltersChange } = setup({ type: "business", filters: { vertical: "food" } })
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

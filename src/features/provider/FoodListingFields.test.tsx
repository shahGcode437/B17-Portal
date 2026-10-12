import { useState } from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { FoodListingFields } from "@/features/provider/FoodListingFields"
import { emptyFoodFormValues } from "@/features/provider/listingBuilders"
import { validateFoodFields, type FoodFieldErrors, type FoodFormValues } from "@/features/provider/listingSchema"

/** Controlled harness, like ListingForm: the fields own no state themselves. */
function Harness({ initial = emptyFoodFormValues(), showErrors = false, onChange }: { initial?: FoodFormValues; showErrors?: boolean; onChange?: (v: FoodFormValues) => void }) {
  const [value, setValue] = useState(initial)
  const errors: FoodFieldErrors = showErrors ? validateFoodFields(value) : {}
  return (
    <FoodListingFields
      value={value}
      errors={errors}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

const category = (name: string) => screen.getByRole("checkbox", { name })

describe("Food categories", () => {
  it("offers every canonical category as a labelled checkbox", () => {
    render(<Harness />)
    const group = screen.getByRole("group", { name: "Food categories" })
    expect(within(group).getAllByRole("checkbox")).toHaveLength(11)
    expect(category("Biryani / Rice")).not.toBeChecked()
  })

  it("the first chosen category is the primary one and is marked", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(category("Bakeries"))
    await user.click(category("Cafes"))
    const chosen = screen.getByRole("list", { name: "Selected categories" })
    const items = within(chosen).getAllByRole("listitem")
    expect(items[0]).toHaveTextContent("Bakeries")
    expect(within(items[0]).getByText("Primary")).toBeInTheDocument()
    expect(within(items[1]).queryByText("Primary")).not.toBeInTheDocument()
  })

  it("'Make primary' reorders the choice", async () => {
    const user = userEvent.setup()
    let latest: FoodFormValues | undefined
    render(<Harness onChange={(v) => (latest = v)} />)
    await user.click(category("Bakeries"))
    await user.click(category("Cafes"))
    await user.click(screen.getByRole("button", { name: "Make Cafes the primary category" }))
    expect(latest?.categories).toEqual(["cafes", "bakeries"])
    const items = within(screen.getByRole("list", { name: "Selected categories" })).getAllByRole("listitem")
    expect(items[0]).toHaveTextContent("Cafes")
  })

  it("allows at most three categories: the others are disabled until one is unchecked", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    for (const name of ["Bakeries", "Cafes", "BBQ"]) await user.click(category(name))
    expect(category("Restaurants")).toBeDisabled()
    expect(category("Bakeries")).toBeEnabled()
    await user.click(category("Cafes"))
    expect(category("Restaurants")).toBeEnabled()
  })
})

describe("Service options", () => {
  it("uses the canonical labels, including 'Delivery by the business' with the no-platform-delivery note", () => {
    render(<Harness />)
    expect(screen.getByRole("checkbox", { name: "Dine-in" })).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Delivery by the business" })).toBeInTheDocument()
    expect(screen.getByText(/B-17 Portal does not provide\s+delivery/i)).toBeInTheDocument()
  })

  it("stores the chosen options in canonical order, whatever the click order", async () => {
    const user = userEvent.setup()
    let latest: FoodFormValues | undefined
    render(<Harness onChange={(v) => (latest = v)} />)
    await user.click(screen.getByRole("checkbox", { name: "Delivery by the business" }))
    await user.click(screen.getByRole("checkbox", { name: "Takeaway" }))
    expect(latest?.serviceOptions).toEqual(["takeaway", "delivery"])
  })
})

describe("Menu highlights", () => {
  it("adds and removes rows with named controls and moves focus sensibly", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByText("0 of 8 items")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add menu item" }))
    expect(screen.getByLabelText("Item name")).toHaveFocus() // the new row's name field
    await user.click(screen.getByRole("button", { name: "Add menu item" }))
    expect(screen.getAllByLabelText("Item name")).toHaveLength(2)
    expect(screen.getByText("2 of 8 items")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Remove menu item 1" }))
    expect(screen.getAllByLabelText("Item name")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Add menu item" })).toHaveFocus() // focus is not lost on removal
  })

  it("stops at eight rows", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    for (let i = 0; i < 8; i++) await user.click(screen.getByRole("button", { name: "Add menu item" }))
    expect(screen.getByText("8 of 8 items")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add menu item" })).toBeDisabled()
  })

  it("keeps the optional fields optional and the item name required", async () => {
    const user = userEvent.setup()
    render(<Harness showErrors />)
    await user.click(screen.getByRole("button", { name: "Add menu item" }))
    expect(screen.getByLabelText("Section (optional)")).toBeInTheDocument()
    expect(screen.getByLabelText("Price (optional)")).toBeInTheDocument()
    expect(screen.getByLabelText("Description (optional)")).toBeInTheDocument()
    const name = screen.getByLabelText("Item name")
    expect(name).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("Please enter the item name.")).toBeInTheDocument()
    expect(name).toHaveAccessibleDescription("Please enter the item name.")
    await user.type(name, "Karahi")
    expect(screen.queryByText("Please enter the item name.")).not.toBeInTheDocument()
  })
})

describe("Validation messages", () => {
  it("links category and service errors to their groups", () => {
    render(<Harness showErrors />)
    expect(screen.getByRole("group", { name: "Food categories" })).toHaveAccessibleDescription(/Choose at least one category/)
    expect(screen.getByRole("group", { name: "Service options" })).toHaveAccessibleDescription(/Choose at least one service option/)
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(
      expect.arrayContaining(["Choose at least one category.", "Choose at least one service option."])
    )
  })
})

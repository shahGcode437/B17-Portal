import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { SearchBar } from "@/components/inputs/SearchBar"
import type { SearchSuggestion } from "@/types/search"

const suggestions: SearchSuggestion[] = [
  { id: "s1", label: "Biryani", secondaryLabel: "Directory", type: "business", value: "Biryani" },
  { id: "s2", label: "Biryani House", secondaryLabel: "Directory · Biryani / Rice", type: "business", value: "Biryani House" },
  { id: "s3", label: "Chicken Biryani", secondaryLabel: "Directory", type: "business", value: "Chicken Biryani" },
]

function Harness({ onSubmit = vi.fn(), onSuggestionSelect = vi.fn(), withSuggestions = true }: { onSubmit?: (v: string) => void; onSuggestionSelect?: (s: SearchSuggestion) => void; withSuggestions?: boolean }) {
  const [value, setValue] = useState("")
  return (
    <SearchBar
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      suggestions={withSuggestions && value.length >= 2 ? suggestions : []}
      onSuggestionSelect={withSuggestions ? onSuggestionSelect : undefined}
    />
  )
}

describe("SearchBar", () => {
  it("is a labelled search landmark with a combobox and a Search button", () => {
    render(<Harness />)
    expect(screen.getByRole("search")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Search B-17 Portal" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument()
  })

  it("accepts a custom accessible name for scoped searches (e.g. Food & Dining)", () => {
    render(<SearchBar value="" onChange={() => {}} label="Search Food & Dining" />)
    expect(screen.getByRole("searchbox", { name: "Search Food & Dining" })).toBeInTheDocument()
  })

  it("shows suggestions as a listbox once there is enough text, and announces the count", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByRole("combobox")
    expect(input).toHaveAttribute("aria-expanded", "false")
    await user.type(input, "bi")
    expect(input).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(screen.getAllByRole("option")).toHaveLength(3)
    expect(screen.getByText(/3 suggestions available/i)).toBeInTheDocument()
  })

  it("moves through suggestions with ArrowDown/ArrowUp and selects the active one with Enter", async () => {
    const user = userEvent.setup()
    const onSuggestionSelect = vi.fn()
    const onSubmit = vi.fn()
    render(<Harness onSuggestionSelect={onSuggestionSelect} onSubmit={onSubmit} />)
    const input = screen.getByRole("combobox")
    await user.type(input, "bi")
    await user.keyboard("{ArrowDown}{ArrowDown}")
    const options = screen.getAllByRole("option")
    expect(options[1]).toHaveAttribute("aria-selected", "true")
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id)
    await user.keyboard("{ArrowUp}")
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true")
    await user.keyboard("{ArrowDown}{Enter}")
    expect(onSuggestionSelect).toHaveBeenCalledWith(suggestions[1])
    expect(onSubmit).not.toHaveBeenCalled() // picking a suggestion is not a free-text submit
  })

  it("closes the list on Escape without clearing what was typed", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByRole("combobox")
    await user.type(input, "bi")
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(input).toHaveValue("bi")
    expect(input).toHaveAttribute("aria-expanded", "false")
  })

  it("selects a suggestion with the mouse", async () => {
    const user = userEvent.setup()
    const onSuggestionSelect = vi.fn()
    render(<Harness onSuggestionSelect={onSuggestionSelect} />)
    await user.type(screen.getByRole("combobox"), "bi")
    await user.click(screen.getByRole("option", { name: /Chicken Biryani/ }))
    expect(onSuggestionSelect).toHaveBeenCalledWith(suggestions[2])
  })

  it("submits the typed text on Enter (no active suggestion) and via the Search button", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await user.type(screen.getByRole("combobox"), "karahi{Enter}")
    expect(onSubmit).toHaveBeenLastCalledWith("karahi")
    await user.click(screen.getByRole("button", { name: "Search" }))
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it("is a plain search box (no combobox semantics) when no suggestion handler is given", () => {
    render(<Harness withSuggestions={false} />)
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(screen.getByRole("searchbox")).toBeInTheDocument()
  })
})

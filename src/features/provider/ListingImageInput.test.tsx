import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { IMAGE_UPLOAD_NOTICE, ListingImageInput } from "@/features/provider/ListingImageInput"

afterEach(() => vi.restoreAllMocks())

describe("ListingImageInput is honest about uploads (S4)", () => {
  it("says plainly that image upload is not available yet, and that a new listing goes without an image", () => {
    render(<ListingImageInput id="img" onChange={vi.fn()} />)
    expect(screen.getByText(/Image upload isn't available yet\. It is planned for a later release\./)).toBeInTheDocument()
    expect(screen.getByText(/submitted without an image/)).toBeInTheDocument()
    expect(IMAGE_UPLOAD_NOTICE).toMatch(/isn't available yet/)
  })

  it("offers no way to pick a file: the button is disabled and described by the notice, and there is no file input", () => {
    const { container } = render(<ListingImageInput id="img" onChange={vi.fn()} />)
    const choose = screen.getByRole("button", { name: "Choose Image" })
    expect(choose).toBeDisabled()
    expect(choose).toHaveAccessibleDescription(/Image upload isn't available yet/)
    expect(container.querySelector('input[type="file"]')).toBeNull()
  })

  it("never creates a browser-local object URL (nothing looks attached that cannot be saved)", async () => {
    const create = vi.fn(() => "blob:never")
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create }))
    const user = userEvent.setup()
    render(<ListingImageInput id="img" onChange={vi.fn()} />)
    await user.click(screen.getByRole("button", { name: "Choose Image" }))
    expect(create).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("shows the image already on file, says it is kept, and lets the owner remove it", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ListingImageInput id="img" value="https://cdn.example.org/shop.jpg" onChange={onChange} />)
    expect(screen.getByRole("img", { name: "Current listing image" })).toHaveAttribute("src", "https://cdn.example.org/shop.jpg")
    expect(screen.getByText(/The image on file is kept unless you remove it\./)).toBeInTheDocument()
    expect(screen.queryByText(/submitted without an image/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Remove" }))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it("keeps its label for a second use (the Food menu image)", () => {
    render(<ListingImageInput id="menu" label="Menu image" contain onChange={vi.fn()} />)
    expect(screen.getByText("Menu image")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Choose Image" })).toBeDisabled()
  })
})

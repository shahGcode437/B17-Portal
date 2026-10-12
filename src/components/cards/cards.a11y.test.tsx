import type { ReactElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BusinessCard } from "@/components/cards/BusinessCard"
import { ProviderCard } from "@/components/cards/ProviderCard"
import { PropertyCard } from "@/components/cards/PropertyCard"
import { TutorCard } from "@/components/cards/TutorCard"
import { AuthContext } from "@/hooks/useAuth"
import { ToastContext } from "@/hooks/useToast"
import { getBusinessById, getProviderById, getPropertyById, getTutorById } from "@/services/search"
import { useResidentStore } from "@/state/residentStore"
import type { Business } from "@/types/business"
import type { Property } from "@/types/property"
import type { Provider } from "@/types/provider"
import type { Tutor } from "@/types/tutor"

/**
 * Regression for the nested-interactive bug found by Playwright MCP (Phase 9M): result cards were a
 * `role="button"` element that CONTAINED the Save / WhatsApp / Contact buttons. ARIA forbids
 * interactive content inside a button, and assistive tech cannot reach the inner controls reliably.
 * Cards must be a plain container with a separate preview control and independent action buttons.
 */
const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])'

function renderCard(ui: ReactElement) {
  const show = vi.fn()
  const login = vi.fn()
  const utils = render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { name: "Tester" }, login, logout: vi.fn() }}>
        <ToastContext.Provider value={{ show }}>{ui}</ToastContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
  return { ...utils, show }
}

function nestedInteractive(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(INTERACTIVE)]
    .filter((el) => el.parentElement?.closest(INTERACTIVE) && root.contains(el.parentElement.closest(INTERACTIVE)))
    .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute("aria-label") ?? el.textContent?.trim()}] inside ${el.parentElement?.closest(INTERACTIVE)?.tagName.toLowerCase()}`)
}

// The resident store is a module singleton: start every test with nothing saved.
beforeEach(() => {
  useResidentStore.setState({ savedItems: [], requests: [] })
})

const business = getBusinessById("business-08") as Business
const provider = getProviderById("provider-construction-01") as Provider
const tutor = getTutorById("tutor-physics-01") as Tutor
const property = getPropertyById("property-01") as Property

const cards: { name: string; label: string; actions: RegExp[]; element: (onSelect: () => void) => ReactElement }[] = [
  { name: "BusinessCard", label: business.name, actions: [/whatsapp/i, /contact/i], element: (onSelect) => <BusinessCard business={business} onSelect={onSelect} /> },
  { name: "ProviderCard", label: provider.name, actions: [/whatsapp/i, /request/i], element: (onSelect) => <ProviderCard provider={provider} onSelect={onSelect} /> },
  { name: "TutorCard", label: tutor.name, actions: [/whatsapp/i], element: (onSelect) => <TutorCard tutor={tutor} onSelect={onSelect} /> },
  { name: "PropertyCard", label: property.title, actions: [/contact/i], element: (onSelect) => <PropertyCard property={property} onSelect={onSelect} /> },
]

describe.each(cards)("$name accessibility semantics", ({ label, actions, element }) => {
  it("has no interactive control nested inside another interactive control", () => {
    const { container } = renderCard(element(vi.fn()))
    expect(nestedInteractive(container)).toEqual([])
  })

  it("exposes a preview control, a Save button and the action buttons as separate, named controls", () => {
    renderCard(element(vi.fn()))
    expect(screen.getByRole("button", { name: `Preview ${label}` })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: `Save ${label}` })).toBeInTheDocument()
    for (const action of actions) expect(screen.getByRole("button", { name: action })).toBeInTheDocument()
  })

  it("opens the preview from the mouse and from the keyboard (Enter / Space)", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderCard(element(onSelect))
    const preview = screen.getByRole("button", { name: `Preview ${label}` })

    await user.click(preview)
    expect(onSelect).toHaveBeenCalledTimes(1)

    preview.focus()
    await user.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledTimes(2)
    await user.keyboard(" ")
    expect(onSelect).toHaveBeenCalledTimes(3)
  })

  it("keeps Save independent of the preview: saving does not open the preview", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { show } = renderCard(element(onSelect))
    await user.click(screen.getByRole("button", { name: `Save ${label}` }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledWith(`Saved ${label}`)
    expect(screen.getByRole("button", { name: `Remove ${label} from saved` })).toHaveAttribute("aria-pressed", "true")
  })

  it("lets keyboard users reach every control in a sensible order (preview first)", async () => {
    const user = userEvent.setup()
    renderCard(element(vi.fn()))
    await user.tab()
    expect(screen.getByRole("button", { name: `Preview ${label}` })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: `Save ${label}` })).toHaveFocus()
  })
})

describe("a card without a preview action", () => {
  it("renders no preview control (e.g. the listing preview on the create form)", () => {
    renderCard(<BusinessCard business={business} />)
    expect(screen.queryByRole("button", { name: `Preview ${business.name}` })).not.toBeInTheDocument()
  })
})

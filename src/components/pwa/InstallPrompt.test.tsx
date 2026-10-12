import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const DISMISS_KEY = "b17.pwa.installDismissedAt"

/**
 * The install state is a module singleton (the browser event can fire before React mounts), so each
 * test loads a fresh copy of the modules. Chromium's native install prompt is simulated with a
 * synthetic `beforeinstallprompt` event; the OS-level install dialog itself is not automatable.
 */
async function load() {
  vi.resetModules()
  const install = await import("@/pwa/install")
  const { InstallPrompt } = await import("@/components/pwa/InstallPrompt")
  install.initInstallCapture()
  return { install, InstallPrompt }
}

function fireInstallEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = vi.fn(() => Promise.resolve())
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  })
  act(() => {
    window.dispatchEvent(event)
  })
  return { prompt, event }
}

function stubMatchMedia(matches: (query: string) => boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  Object.defineProperty(window, "matchMedia", { configurable: true, value: globalThis.matchMedia })
}

const stubUserAgent = (ua: string) => vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua)

beforeEach(() => stubMatchMedia(() => false))
afterEach(() => vi.unstubAllGlobals())

describe("InstallPrompt", () => {
  it("renders nothing until the browser offers an install (a website visit never needs it)", async () => {
    const { InstallPrompt } = await load()
    render(<InstallPrompt />)
    expect(screen.queryByRole("region", { name: /install/i })).not.toBeInTheDocument()
  })

  it("offers a real Install button when the browser fires beforeinstallprompt, and triggers the browser prompt", async () => {
    const user = userEvent.setup()
    const { InstallPrompt } = await load()
    render(<InstallPrompt />)
    const { prompt, event } = fireInstallEvent()
    expect(event.defaultPrevented).toBe(true) // we replace the mini-infobar with our own control
    expect(screen.getByRole("region", { name: "Install B-17 Portal" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Install" }))
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it("hides after the app is installed", async () => {
    const { InstallPrompt } = await load()
    render(<InstallPrompt />)
    fireInstallEvent()
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new Event("appinstalled"))
    })
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument()
  })

  it("can be dismissed with a named button, remembers it locally, and does not come back", async () => {
    const user = userEvent.setup()
    const { InstallPrompt, install } = await load()
    const view = render(<InstallPrompt />)
    fireInstallEvent()
    await user.click(screen.getByRole("button", { name: "Dismiss install suggestion" }))
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument()
    expect(window.localStorage.getItem(DISMISS_KEY)).toMatch(/^\d+$/)
    view.unmount()

    // A later visit (new module state, same storage): a fresh install event is still suppressed.
    expect(install.getInstallMode()).toBe("none")
    const second = await load()
    render(<second.InstallPrompt />)
    fireInstallEvent()
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument()
  })

  it("shows nothing when already running installed (standalone display mode)", async () => {
    stubMatchMedia((query) => query.includes("standalone"))
    const { InstallPrompt } = await load()
    render(<InstallPrompt />)
    fireInstallEvent()
    expect(screen.queryByRole("region", { name: /install/i })).not.toBeInTheDocument()
  })

  it("gives iPhone users manual Share → Add to Home Screen guidance, with no fake Install button", async () => {
    stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1")
    const { InstallPrompt } = await load()
    render(<InstallPrompt />)
    const region = screen.getByRole("region", { name: "Install B-17 Portal" })
    expect(region).toHaveTextContent(/Share/)
    expect(region).toHaveTextContent(/Add to Home Screen/)
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Dismiss install suggestion" })).toBeInTheDocument()
  })

  it("hides the iOS guidance when launched from the home screen (navigator.standalone)", async () => {
    stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1")
    // jsdom has no `navigator.standalone` (iOS Safari only), so define it for this test and remove it after.
    Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true })
    try {
      const { InstallPrompt } = await load()
      render(<InstallPrompt />)
      expect(screen.queryByRole("region", { name: /install/i })).not.toBeInTheDocument()
    } finally {
      Reflect.deleteProperty(window.navigator, "standalone")
    }
  })
})

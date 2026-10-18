import { afterEach, describe, expect, it, vi } from "vitest"
import { captureFragmentToken, clearFragmentToken, takeFragmentToken } from "@/lib/fragmentToken"

function visit(path: string) {
  window.history.replaceState({ key: "router-state" }, "", path)
}

afterEach(() => {
  clearFragmentToken()
  visit("/")
})

describe("fragment token lifecycle", () => {
  it("moves the token into memory and removes the fragment immediately", () => {
    visit("/verify-email#token=abc123")

    captureFragmentToken()

    expect(window.location.hash).toBe("")
    expect(window.location.pathname + window.location.search).toBe("/verify-email")
    expect(takeFragmentToken("/verify-email")).toBe("abc123")
  })

  it("is idempotent, so a repeated render or StrictMode double call keeps the token", () => {
    visit("/reset-password#token=xyz")

    expect(takeFragmentToken("/reset-password")).toBe("xyz")
    expect(takeFragmentToken("/reset-password")).toBe("xyz")
    expect(window.location.hash).toBe("")
  })

  it("preserves the history state and the query string while stripping", () => {
    visit("/verify-email?x=1#token=t")

    captureFragmentToken()

    expect(window.history.state).toEqual({ key: "router-state" })
    expect(window.location.search).toBe("?x=1")
  })

  it("returns nothing for another route, or when there was no token", () => {
    visit("/verify-email#token=abc")
    captureFragmentToken()

    expect(takeFragmentToken("/reset-password")).toBeNull()
    clearFragmentToken()
    expect(takeFragmentToken("/verify-email")).toBeNull()
  })

  it("ignores fragments on other routes and a fragment without a token", () => {
    visit("/search#token=nope")
    captureFragmentToken()
    expect(window.location.hash).toBe("#token=nope") // not a token route: untouched

    visit("/verify-email#other=1")
    captureFragmentToken()
    expect(window.location.hash).toBe("") // stripped, but nothing captured
    expect(takeFragmentToken("/verify-email")).toBeNull()
  })

  it("never writes the token to web storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem")
    visit("/verify-email#token=secret-token-value")

    captureFragmentToken()
    takeFragmentToken("/verify-email")

    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage)).not.toContain("secret-token-value")
  })
})

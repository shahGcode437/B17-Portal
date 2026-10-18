/// <reference types="node" />
import { readFileSync } from "node:fs"
import { createBrowserRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

function visit(path: string) {
  window.history.replaceState({ key: "router-state" }, "", path)
}

afterEach(() => {
  vi.resetModules()
  visit("/")
})

describe("fragment sanitization happens before any application module is evaluated", () => {
  it("main.tsx imports the bootstrap module first, ahead of React, the stylesheet, App and the PWA code", () => {
    const source = readFileSync("src/main.tsx", "utf8")
    const imports = [...source.matchAll(/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1])

    expect(imports[0]).toBe("./lib/fragmentBootstrap")
    expect(imports.indexOf("./App.tsx")).toBeGreaterThan(0)
    // The old in-body call is gone: the only capture is the import-time one.
    expect(source).not.toMatch(/captureFragmentToken\s*\(/)
  })

  it("the bootstrap module imports nothing but the token helper", () => {
    const source = readFileSync("src/lib/fragmentBootstrap.ts", "utf8")
    const imports = [...source.matchAll(/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1])

    expect(imports).toEqual(["./fragmentToken"])
  })

  it("the app router is created at MODULE scope, i.e. while its importer is still being evaluated (the hazard being closed)", () => {
    // Reading the real router module through the bundler would cold-transform the whole app (slow on
    // a loaded machine), so the fact that matters is asserted on its source and the behaviour on a
    // router of the same kind below.
    const source = readFileSync("src/app/router.tsx", "utf8")

    expect(source).toMatch(/^export const router = createBrowserRouter\(/m)
  })

  it("without the bootstrap, a browser router created at import time WOULD see the token", () => {
    visit("/reset-password#token=secret-router-token")

    const router = createBrowserRouter([{ path: "*", element: null }])

    expect(router.state.location.hash).toContain("secret-router-token")
    router.dispose()
  })

  it("with the bootstrap evaluated first, a router created afterwards sees an already-clean URL and the token waits in memory", async () => {
    visit("/reset-password?x=1#token=secret-router-token")

    await import("@/lib/fragmentBootstrap")
    const router = createBrowserRouter([{ path: "*", element: null }])
    const { takeFragmentToken } = await import("@/lib/fragmentToken")

    expect(router.state.location.pathname).toBe("/reset-password")
    expect(router.state.location.search).toBe("?x=1")
    expect(router.state.location.hash).toBe("")
    expect(window.location.hash).toBe("")
    expect(takeFragmentToken("/reset-password")).toBe("secret-router-token")
    router.dispose()
  })

  it("runs no side effect at import time other than the capture (no fetch, no storage, no console)", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const setItem = vi.spyOn(Storage.prototype, "setItem")
    const log = vi.spyOn(console, "log")
    const info = vi.spyOn(console, "info")
    const warn = vi.spyOn(console, "warn")
    visit("/verify-email#token=another-secret")

    await import("@/lib/fragmentBootstrap")

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    for (const spy of [log, info, warn]) expect(spy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe("token-route-only capture and URL cleanup", () => {
  it("also handles a trailing slash on the token route", async () => {
    visit("/verify-email/#token=slash-token")
    const { captureFragmentToken, takeFragmentToken, clearFragmentToken } = await import("@/lib/fragmentToken")

    captureFragmentToken()

    expect(window.location.pathname).toBe("/verify-email/")
    expect(window.location.hash).toBe("")
    expect(takeFragmentToken("/verify-email")).toBe("slash-token")
    clearFragmentToken()
  })

  it("leaves unrelated fragments and the login error query alone on every other route", async () => {
    const { captureFragmentToken, takeFragmentToken } = await import("@/lib/fragmentToken")

    for (const url of ["/#token=nope", "/login?error=oauth_denied#token=nope", "/search?q=a#section", "/profile#token=x"]) {
      visit(url)
      captureFragmentToken()
      expect(window.location.pathname + window.location.search + window.location.hash).toBe(url)
    }
    expect(takeFragmentToken("/verify-email")).toBeNull()
    expect(takeFragmentToken("/reset-password")).toBeNull()
  })

  it("does not capture a token that arrived in the QUERY string (only the fragment is a token channel)", async () => {
    visit("/verify-email?token=in-the-query")
    const { captureFragmentToken, takeFragmentToken } = await import("@/lib/fragmentToken")

    captureFragmentToken()

    expect(takeFragmentToken("/verify-email")).toBeNull()
  })
})

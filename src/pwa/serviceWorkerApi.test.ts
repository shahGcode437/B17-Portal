/// <reference types="node" />
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"

/**
 * Phase 12C: authentication needs the network. The shipped worker template (`pwa/sw.template.js`) is
 * executed here against a fake worker scope, to prove same-origin API requests are never answered
 * from a cache, never replaced by the cached app shell when offline, and never stored — while the
 * existing shell behaviour (navigation fallback, /assets caching) is untouched.
 */

type FetchListener = (event: {
  request: { method: string; url: string; mode: string }
  respondWith: (response: unknown) => void
}) => void

function loadWorker() {
  const template = readFileSync(resolve(process.cwd(), "pwa/sw.template.js"), "utf8")
  const source = template.replace("__BUILD_ID__", "test").replace("__PRECACHE_URLS__", JSON.stringify(["/"]))
  const listeners: Record<string, FetchListener> = {}
  const self = {
    location: { origin: "https://app.example.org" },
    addEventListener: (type: string, listener: FetchListener) => {
      listeners[type] = listener
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  }
  const caches = {
    open: vi.fn(async () => ({ match: async () => undefined, put: vi.fn(), addAll: vi.fn() })),
    match: vi.fn(async () => undefined),
    keys: vi.fn(async () => []),
    delete: vi.fn(),
  }
  new Function("self", "caches", "fetch", "Request", "Response", source)(
    self,
    caches,
    vi.fn(async () => ({ ok: true, type: "basic", clone: () => ({}) })),
    class {},
    { error: () => "offline-error" }
  )
  return { fetchListener: listeners.fetch, caches }
}

function dispatch(listener: FetchListener, url: string, mode = "cors", method = "GET") {
  const respondWith = vi.fn()
  listener({ request: { method, url, mode }, respondWith })
  return respondWith
}

describe("service worker and the API", () => {
  const { fetchListener, caches } = loadWorker()

  it.each([
    ["an auth read", "https://app.example.org/api/v1/auth/me", "cors"],
    ["an auth write", "https://app.example.org/api/v1/auth/login", "cors"],
    ["the OAuth callback navigation", "https://app.example.org/api/v1/auth/oauth/google/callback?code=x&state=y", "navigate"],
    ["any other API path", "https://app.example.org/api/v1/search?q=a", "cors"],
    ["the bare /api path", "https://app.example.org/api", "navigate"],
  ])("never touches %s (no cache, no offline shell substitution)", (_label, url, mode) => {
    caches.open.mockClear()
    caches.match.mockClear()

    const respondWith = dispatch(fetchListener, url, mode)

    expect(respondWith).not.toHaveBeenCalled() // the browser handles it: straight to the network
    expect(caches.open).not.toHaveBeenCalled()
    expect(caches.match).not.toHaveBeenCalled()
  })

  it("still serves the app shell for ordinary navigations (installability / offline shell intact)", () => {
    expect(dispatch(fetchListener, "https://app.example.org/search", "navigate")).toHaveBeenCalledTimes(1)
  })

  it("still caches hashed assets", () => {
    expect(dispatch(fetchListener, "https://app.example.org/assets/app-abc.js")).toHaveBeenCalledTimes(1)
  })

  it("never handles unsafe methods or another origin's API", () => {
    expect(dispatch(fetchListener, "https://app.example.org/x", "cors", "POST")).not.toHaveBeenCalled()
    expect(dispatch(fetchListener, "https://api.example.org/api/v1/auth/me")).not.toHaveBeenCalled()
  })
})

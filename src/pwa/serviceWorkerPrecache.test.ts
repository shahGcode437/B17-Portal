/// <reference types="node" />
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"

/**
 * The worker must serve a precached asset although the page's request differs from the precache's in a header
 * the server listed in `Vary`. The shipped template runs against a fake cache that behaves like the real one
 * for such an entry: WITHOUT `ignoreVary` the lookup misses. (The browser proof is `e2e/pwa/first-visit.spec.ts`.)
 */

function loadWorker() {
  const template = readFileSync(resolve(process.cwd(), "pwa/sw.template.js"), "utf8")
  const source = template.replace("__BUILD_ID__", "test").replace("__PRECACHE_URLS__", JSON.stringify(["/"]))
  const listeners: Record<string, (event: unknown) => void> = {}
  const self = {
    location: { origin: "https://app.example.org" },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  }
  const precached = { from: "precache" }
  const match = vi.fn(async (_request: unknown, options?: { ignoreVary?: boolean }) =>
    options?.ignoreVary ? precached : undefined // stored with `Vary: Origin`, asked for with another Origin
  )
  const caches = { open: vi.fn(async () => ({ match, put: vi.fn(), addAll: vi.fn() })), match: vi.fn(), keys: vi.fn(), delete: vi.fn() }
  const offline = vi.fn(async () => {
    throw new TypeError("offline")
  })
  new Function("self", "caches", "fetch", "Request", "Response", source)(self, caches, offline, class {}, { error: () => "error" })
  return { fetchListener: listeners.fetch, match, offline, precached }
}

describe("service worker and precached assets", () => {
  it.each(["/assets/index-abc123.js", "/assets/index-abc123.css"])("offline, %s comes from the cache despite Vary", async (path) => {
    const { fetchListener, offline, precached } = loadWorker()
    let answer: Promise<unknown> | undefined

    fetchListener({
      request: { method: "GET", url: `https://app.example.org${path}`, mode: "cors" },
      respondWith: (response: Promise<unknown>) => {
        answer = response
      },
    })

    await expect(answer).resolves.toBe(precached)
    expect(offline).not.toHaveBeenCalled()
  })

  it("ignores Vary for built assets only: an API request is still never looked up", () => {
    const { fetchListener, match } = loadWorker()
    const respondWith = vi.fn()

    fetchListener({ request: { method: "GET", url: "https://app.example.org/api/v1/grocery/orders", mode: "cors" }, respondWith })

    expect(respondWith).not.toHaveBeenCalled()
    expect(match).not.toHaveBeenCalled()
  })
})

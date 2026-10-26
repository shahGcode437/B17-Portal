import { afterEach, describe, expect, it, vi } from "vitest"
import type { ConfigEnv } from "vite"
import viteConfig, { API_PROXY_TARGET, apiProxy, devWatchIgnored } from "../../vite.config"

/**
 * Phase 12S regression: the browser talks to ITS OWN origin (`/api/v1`) and Vite forwards `/api` to the
 * API. A page at `localhost:5173` that called `127.0.0.1:8000` directly is cross-site: the backend
 * refused every register / login with `csrf_failed` (Sec-Fetch-Site: cross-site). These tests keep the
 * default relative and the proxy in place; the real-stack lane proves it end to end with cookies.
 */
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function apiBase(env: { DEV: boolean; override?: string }) {
  vi.resetModules()
  vi.stubEnv("DEV", env.DEV)
  vi.stubEnv("VITE_API_BASE_URL", env.override ?? "")
  return (await import("@/config/api")).API_BASE_URL
}

describe("API base URL", () => {
  it("is the relative /api/v1 in development", async () => {
    expect(await apiBase({ DEV: true })).toBe("/api/v1")
  })

  it("is the same relative /api/v1 in production", async () => {
    expect(await apiBase({ DEV: false })).toBe("/api/v1")
  })

  it("can still be pointed at another origin explicitly (a deployment that really needs it)", async () => {
    expect(await apiBase({ DEV: true, override: "https://api.example.org/api/v1/" })).toBe("https://api.example.org/api/v1")
  })
})

describe("Vite same-origin proxy", () => {
  const dev = viteConfig({ mode: "development", command: "serve", isSsrBuild: false, isPreview: false } satisfies ConfigEnv)

  it("proxies /api on the dev server to the API without rewriting anything", () => {
    expect(dev.server?.proxy).toEqual(apiProxy)
    const rule = (apiProxy as Record<string, Record<string, unknown>>)["/api"]
    expect(rule.target).toBe(API_PROXY_TARGET)
    expect(rule.target).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/)
    // Origin / Cookie / Set-Cookie / Sec-Fetch-Site must pass through untouched, or the backend's CSRF checks mean nothing.
    expect(rule.changeOrigin).toBe(false)
    expect(rule).not.toHaveProperty("rewrite")
    expect(rule).not.toHaveProperty("cookieDomainRewrite")
    expect(rule).not.toHaveProperty("headers")
  })

  it("does the same for `vite preview` (the built app), so it can reach a local API too", () => {
    expect(dev.preview?.proxy).toEqual(apiProxy)
  })

  it("binds loopback with fixed ports and refuses to silently move to another port", () => {
    expect(dev.server).toMatchObject({ host: "127.0.0.1", port: 5173, strictPort: true })
    expect(dev.preview).toMatchObject({ host: "127.0.0.1", port: 4173, strictPort: true })
  })

  it("the dev server does not watch what is not the frontend, so saving a doc or a backend file cannot reload an open page", () => {
    // Found in Phase 12S S3: any saved file under the repo reloaded every open page and reset a half-filled form
    // (a flaky real-stack failure). Everything the browser is served must stay watched; everything else must not.
    expect(dev.server?.watch).toMatchObject({ ignored: devWatchIgnored })
    for (const file of ["docs/development/TESTING.md", "CLAUDE.md", "backend/app/main.py", "e2e-real/helpers/ui.ts", "e2e/reliability.spec.ts", "src/test/setup.ts", "src/app/ScrollManager.test.tsx"]) {
      expect(isIgnored(file), `${file} should be ignored`).toBe(true)
    }
    for (const file of ["src/app/ScrollManager.tsx", "src/index.css", "src/main.tsx", "index.html", "public/robots.txt", "pwa/sw.template.js", "vite.config.ts"]) {
      expect(isIgnored(file), `${file} must stay watched`).toBe(false)
    }
  })
})

/** A minimal glob matcher for the few patterns `devWatchIgnored` uses: `**` (any depth) and `*` (within a segment). */
function globToRegExp(glob: string): RegExp {
  let source = ""
  let i = 0
  while (i < glob.length) {
    if (glob.startsWith("**/", i)) {
      source += "(?:.*/)?"
      i += 3
    } else if (glob.startsWith("**", i)) {
      source += ".*"
      i += 2
    } else if (glob[i] === "*") {
      source += "[^/]*"
      i += 1
    } else {
      source += glob[i] === "." ? "\\." : glob[i]
      i += 1
    }
  }
  return new RegExp(`^${source}$`)
}

function isIgnored(file: string): boolean {
  return devWatchIgnored.some((glob) => globToRegExp(glob).test(file))
}

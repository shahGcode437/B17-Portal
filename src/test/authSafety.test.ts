/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Source audit for the browser-auth security rules (Phase 12C): no authentication or security state
 * in web storage, no reading the (HttpOnly) session cookie, no bearer-token code, no console output
 * in the auth layer. Comments are ignored — only code is judged — and the few legitimate
 * localStorage users outside authentication are listed explicitly, so a new one fails this test.
 */

const SRC = resolve(process.cwd(), "src")

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const sources = walk(SRC)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file) && !file.includes(`${join("src", "test")}`))
  .map((file) => ({ file: relative(SRC, file).replaceAll("\\", "/"), code: stripComments(readFileSync(file, "utf8")) }))

const AUTH_LAYER = (file: string) =>
  file.startsWith("lib/api/") ||
  file.startsWith("features/auth/") ||
  file.startsWith("components/access/") ||
  ["hooks/useAuth.ts", "hooks/useRequireAuth.ts", "hooks/useRequireAdminAuth.ts", "hooks/useReferrerPolicy.ts", "lib/fragmentToken.ts", "lib/safePath.ts", "lib/navigation.ts", "types/auth.ts", "features/admin/AdminLoginPage.tsx", "config/api.ts"].includes(file)

describe("browser auth source audit", () => {
  it("finds the auth layer it is supposed to audit", () => {
    expect(sources.filter(({ file }) => AUTH_LAYER(file)).length).toBeGreaterThan(10)
  })

  it("the auth layer never touches web storage, IndexedDB or document.cookie", () => {
    for (const { file, code } of sources.filter(({ file }) => AUTH_LAYER(file))) {
      expect(code, file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/)
    }
  })

  it("nothing in the app reads document.cookie or implements bearer-token auth", () => {
    for (const { file, code } of sources) {
      expect(code, file).not.toMatch(/document\.cookie/)
      expect(code, file).not.toMatch(/['"`]authorization['"`]|authorization\s*:|bearer\s/i)
    }
  })

  it("the auth layer writes nothing to the console (no passwords, tokens or CSRF values in logs)", () => {
    for (const { file, code } of sources.filter(({ file }) => AUTH_LAYER(file))) {
      expect(code, file).not.toMatch(/console\.\w+/)
    }
  })

  it("localStorage / sessionStorage are used directly only by the install-prompt dismissal", () => {
    const users = sources.filter(({ code }) => /localStorage|sessionStorage/.test(code)).map(({ file }) => file).sort()
    expect(users).toEqual(["pwa/install.ts"])
  })

  it("no Zustand `persist(` call exists in production code (the demo stores were retired in Phase 12H)", () => {
    const persisted = sources.filter(({ code }) => /\bpersist\(/.test(code)).map(({ file }) => file).sort()
    expect(persisted).toEqual([])
  })

  it("the CSRF token is only ever written through lib/api/session (memory)", () => {
    const writers = sources.filter(({ code }) => /setCsrfToken\(/.test(code)).map(({ file }) => file).sort()
    expect(writers).toEqual(["features/auth/AuthProvider.tsx", "lib/api/session.ts"])
  })
})

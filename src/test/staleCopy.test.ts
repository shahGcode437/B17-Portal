/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Source guard for copy that must not come back (Phase 12S Step A). There is no billing and no way to change a plan,
 * so no screen may tell a person to upgrade; and the removed `/provider/listings/pending` route must not be linked
 * or advertised. Comments are ignored - only code (including the strings a person reads) is judged.
 */
const ROOT = resolve(process.cwd())
const SRC = join(ROOT, "src")

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
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file) && !file.includes(join("src", "test")))
  .map((file) => ({ file: relative(SRC, file).replaceAll("\\", "/"), code: stripComments(readFileSync(file, "utf8")) }))

describe("no impossible upgrade direction in user-facing copy", () => {
  it("finds the sources it is meant to audit", () => {
    expect(sources.length).toBeGreaterThan(200)
    expect(sources.some(({ file }) => file === "lib/api/writeErrors.ts")).toBe(true)
    expect(sources.some(({ file }) => file === "features/provider/ListingLimitNotice.tsx")).toBe(true)
  })

  it("nothing tells a person to upgrade, subscribe or buy a plan", () => {
    for (const { file, code } of sources) {
      expect(code, file).not.toMatch(/upgrade (to|your|now|plan)|upgrade to premium|buy premium|subscribe (to|now)|go premium/i)
    }
  })

  it("the plan-limit and limit-notice copy offers archiving, which exists today", () => {
    const errors = sources.find(({ file }) => file === "lib/api/writeErrors.ts")?.code ?? ""
    const notice = sources.find(({ file }) => file === "features/provider/ListingLimitNotice.tsx")?.code ?? ""
    expect(errors).toMatch(/Archive an active listing before/)
    expect(notice).toMatch(/Archive an active listing before/)
  })
})

describe("the removed pending-listing route stays out of the app and its docs", () => {
  it("no source refers to /provider/listings/pending or routes.listingPending", () => {
    for (const { file, code } of sources) {
      expect(code, file).not.toMatch(/listings\/pending|listingPending/)
    }
  })

  it("no other e2e spec uses it, and the current-state docs only mention it to say it was removed", () => {
    // The one real-stack spec that proves it is a plain 404 is the only test that may visit it.
    const mayVisit = (file: string) => relative(ROOT, file).replaceAll("\\", "/") === "e2e-real/15-step-a.spec.ts"
    for (const file of [...walk(join(ROOT, "e2e")), ...walk(join(ROOT, "e2e-real"))].filter((f) => /\.ts$/.test(f) && !mayVisit(f))) {
      expect(readFileSync(file, "utf8"), relative(ROOT, file)).not.toMatch(/listings\/pending/)
    }
    for (const name of ["CURRENT_STATE.md", "ROADMAP.md", "TESTING.md"]) {
      const text = readFileSync(join(ROOT, "docs", "development", name), "utf8")
      for (const line of text.match(/.*listings\/pending.*/g) ?? []) expect(line, name).toMatch(/remov|dead|404|no page/i)
    }
  })
})

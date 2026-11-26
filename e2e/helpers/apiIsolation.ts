/**
 * The mocked E2E lane runs WITHOUT a backend and must never reach one (docs/development/TESTING.md,
 * "API isolation of the mocked lane"). Shared by the config, the global gate, the fixtures and the
 * isolation spec. `apiTripwire.mjs` (plain Node, started by `playwright.config.ts`) repeats the paths and
 * the header; `e2e/isolation.spec.ts` fails if they ever disagree.
 */

/** A dedicated, non-production API target: the ONLY thing the mocked lane's preview server forwards `/api` to. */
export const TRIPWIRE_PORT = 4174
export const TRIPWIRE_ORIGIN = `http://127.0.0.1:${TRIPWIRE_PORT}`
/** Present on every answer of the tripwire. */
export const TRIPWIRE_HEADER = 'x-b17-e2e-tripwire'
/** The tripwire's own report (not under `/api`, so the preview server never forwards it). */
export const ESCAPES_PATH = '/__tripwire/escapes'
/** Deliberate probes by the global setup and the isolation spec. No such API exists; they are not escapes. */
export const PROBE_PREFIX = '/api/__isolation-probe'

export function isApiUrl(url: URL): boolean {
  return url.pathname === '/api' || url.pathname.startsWith('/api/')
}

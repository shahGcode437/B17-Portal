import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { expect, request, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test'

/**
 * Helpers for the REAL-STACK lane (Phase 12I). Everything here talks to the actual local stack:
 * the API at 127.0.0.1:8000, the app at 127.0.0.1:5173 and PostgreSQL through `docker exec psql`.
 *
 * Test-data safety: every account and record the lane creates carries the `P12I` tag in its e-mail
 * (`p12i.<label>.<run>@example.org`) or its name (`P12I-<run> ...`), and `cleanup()` deletes ONLY
 * rows reachable from those tags. Nothing here touches other development data.
 */
export const WEB = 'http://127.0.0.1:5173'
export const API = 'http://127.0.0.1:8000/api/v1'
const ROOT = process.cwd()
const BACKEND = path.join(ROOT, 'backend')
const PY = path.join(BACKEND, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const DB_CONTAINER = process.env.B17_DB_CONTAINER ?? 'b17-portal-db-1'
const DB_NAME = process.env.B17_DB_NAME ?? 'b17_dev'

export const PASSWORD = 'p12i correct horse battery staple'
/** One tag per process; stable across the specs of one `playwright test` run. */
export const RUN = process.env.P12I_RUN ?? (process.env.P12I_RUN = Date.now().toString(36))
export const TAG = `P12I-${RUN}`

export function apiLogPath(): string {
  const file = process.env.B17_API_LOG
  if (!file) throw new Error('Set B17_API_LOG to the file the API stdout is redirected to (development e-mail console).')
  return file
}

// -- browser contexts -------------------------------------------------------------------------------

/** A 1x1 PNG: map tiles are stubbed so the lane never loads (or depends on) a third-party tile server. */
const TILE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

export async function stubTiles(context: BrowserContext) {
  await context.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }))
}

/** Every context of this lane: the app's origin as base URL, the service worker blocked, tiles stubbed. */
export async function newContext(browser: Browser, options: BrowserContextOptions = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: WEB, serviceWorkers: 'block', ...options })
  await stubTiles(context)
  return context
}

// -- PostgreSQL ------------------------------------------------------------------------------------

export function psql(sql: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'b17', '-d', DB_NAME, '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

/** First column of a single-row query, as a string. */
export function scalar(sql: string): string {
  return psql(sql).split('\n')[0]?.split('|')[0] ?? ''
}

export function rows(sql: string): string[][] {
  const out = psql(sql)
  return out === '' ? [] : out.split('\n').map((line) => line.split('|'))
}

// -- accounts --------------------------------------------------------------------------------------

export const emailFor = (label: string) => `p12i.${label}.${RUN}@example.org`

/** Waits for the development e-mail console to print the latest link for `email`, returns its token. */
export async function verificationToken(email: string, kind: 'verify-email' | 'reset-password' = 'verify-email'): Promise<string> {
  const pattern = new RegExp(`To: ${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${kind}#token=([A-Za-z0-9_-]+)`, 'g')
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const text = fs.readFileSync(apiLogPath(), 'utf8')
    const all = [...text.matchAll(pattern)]
    const last = all[all.length - 1]
    if (last) return last[1]!
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`No ${kind} e-mail for ${email} appeared in the API log`)
}

const sharedClients = new Map<string, Promise<ApiClient>>()

/** A minimal API client with its own cookie jar and the CSRF header, for set-up and for "someone else did this". */
export class ApiClient {
  private csrf: string | null = null
  private readonly ctx: APIRequestContext
  private keep = false
  private constructor(ctx: APIRequestContext) {
    this.ctx = ctx
  }

  /**
   * ONE logged-in client per account for the whole run. The backend caps concurrent sessions per user
   * (10, the oldest is revoked), so a helper that logs the same owner in on every call would eventually
   * end that owner's browser session. `dispose()` on a shared client is a no-op.
   */
  static async shared(email: string): Promise<ApiClient> {
    let client = sharedClients.get(email)
    if (!client) {
      client = (async () => {
        const created = await ApiClient.create()
        await created.login(email)
        created.keep = true
        return created
      })()
      sharedClients.set(email, client)
    }
    return client
  }

  static async create(): Promise<ApiClient> {
    return new ApiClient(await request.newContext({ baseURL: API + '/', extraHTTPHeaders: { Origin: WEB } }))
  }

  async call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, data?: unknown, headers: Record<string, string> = {}) {
    const rel = url.replace(/^\//, '')
    const unsafe = method !== 'GET'
    const response = await this.ctx.fetch(rel, {
      method,
      ...(data !== undefined ? { data } : {}),
      headers: { ...(unsafe && this.csrf ? { 'X-CSRF-Token': this.csrf } : {}), ...headers },
    })
    const text = await response.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    return { status: response.status(), body: body as { data?: any; error?: { code: string; details?: { field?: string; code?: string }[] } } | null }
  }

  async login(email: string): Promise<void> {
    const r = await this.call('POST', '/auth/login', { email, password: PASSWORD })
    if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`)
    this.csrf = r.body!.data.csrfToken
  }

  async dispose() {
    if (this.keep) return
    await this.ctx.dispose()
  }
}

export interface TestUser {
  email: string
  name: string
  label: string
}

/** Registers (API), verifies (token from the API's e-mail console) and optionally grants a capability. */
export async function createUser(
  label: string,
  opts: { professional?: 'free' | 'premium'; admin?: boolean; verified?: boolean } = {}
): Promise<TestUser> {
  const email = emailFor(label)
  const name = `${TAG} ${label}`
  const api = await ApiClient.create()
  try {
    const reg = await api.call('POST', '/auth/register', { email, password: PASSWORD, displayName: name })
    if (reg.status !== 201) throw new Error(`register ${email}: ${reg.status} ${JSON.stringify(reg.body)}`)
    if (opts.verified !== false) {
      const token = await verificationToken(email)
      const v = await api.call('POST', '/auth/verify-email', { token })
      if (v.status !== 204) throw new Error(`verify ${email}: ${v.status}`)
    }
    if (opts.professional) {
      await api.login(email)
      const p = await api.call('PUT', '/users/me/professional-profile', {})
      if (p.status !== 200 && p.status !== 201) throw new Error(`profile ${email}: ${p.status} ${JSON.stringify(p.body)}`)
      if (opts.professional === 'premium') {
        psql(`UPDATE professional_profiles SET plan_code = 'premium' WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`)
      }
    }
    if (opts.admin) {
      execFileSync(PY, ['-m', 'app.cli.admin', 'grant', email], { cwd: BACKEND, encoding: 'utf8' })
    }
  } finally {
    await api.dispose()
  }
  return { email, name, label }
}

/** Logs `user` in through the REAL Log In form on a fresh browser context; returns its page. */
export async function signInAs(browser: Browser, user: TestUser, landing?: string): Promise<Page> {
  const context = await newContext(browser)
  const page = await context.newPage()
  await loginOn(page, user, landing)
  return page
}

export async function loginOn(page: Page, user: TestUser, landing?: string) {
  await page.goto('/login')
  await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toBeVisible()
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toHaveCount(0)
  if (landing) {
    await page.goto(landing)
  }
}

export async function expectH1(page: Page, name: string | RegExp) {
  const h1 = page.getByRole('heading', { level: 1, name })
  await expect(h1).toHaveCount(1)
  await expect(h1).toBeVisible()
}

/** The signed-in owner's listing card on the dashboard (a name can appear on several cards). */
export const ownerCard = (page: Page, name: string) =>
  page.locator('[data-slot="card"]').filter({ hasText: name }).filter({ has: page.getByRole('button', { name: 'View' }) })

// -- cleanup ---------------------------------------------------------------------------------------

const TAG_USERS = `(SELECT id FROM users WHERE email LIKE 'p12i.%')`
const TAG_LISTINGS = `(SELECT id FROM listings WHERE owner_id IN ${TAG_USERS})`

/**
 * The rate limiter keys its counters by sha256 of an identifier (an e-mail, a user id, or "user:listing"),
 * so P12I residue in `auth_rate_limits` can only be found by recomputing those hashes for the tagged
 * accounts. Computed from the tagged rows BEFORE they are deleted.
 */
export function rateLimitKeys(): string[] {
  const hash = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
  const keys = new Set<string>()
  for (const [email, id] of rows(`SELECT email, id FROM users WHERE email LIKE 'p12i.%'`)) {
    keys.add(hash(email!))
    keys.add(hash(id!))
  }
  for (const [requester, listing] of rows(`SELECT requester_id, provider_listing_id FROM service_requests WHERE requester_id IN ${TAG_USERS} OR provider_listing_id IN ${TAG_LISTINGS}`)) {
    keys.add(hash(`${requester}:${listing}`))
  }
  return [...keys]
}

const inKeys = (keys: string[]) => (keys.length === 0 ? `(NULL)` : `(${keys.map((k) => `decode('${k}','hex')`).join(',')})`)

export function countP12I(keys: string[] = rateLimitKeys()): Record<string, number> {
  const q = (sql: string) => Number(scalar(sql))
  return {
    users: q(`SELECT count(*) FROM users WHERE email LIKE 'p12i.%'`),
    professionalProfiles: q(`SELECT count(*) FROM professional_profiles WHERE user_id IN ${TAG_USERS}`),
    listings: q(`SELECT count(*) FROM listings WHERE owner_id IN ${TAG_USERS}`),
    listingHistory: q(`SELECT count(*) FROM listing_status_history WHERE listing_id IN ${TAG_LISTINGS}`),
    savedItems: q(`SELECT count(*) FROM saved_items WHERE user_id IN ${TAG_USERS} OR listing_id IN ${TAG_LISTINGS}`),
    requests: q(`SELECT count(*) FROM service_requests WHERE requester_id IN ${TAG_USERS} OR provider_listing_id IN ${TAG_LISTINGS}`),
    requestHistory: q(
      `SELECT count(*) FROM service_request_status_history WHERE request_id IN (SELECT id FROM service_requests WHERE requester_id IN ${TAG_USERS} OR provider_listing_id IN ${TAG_LISTINGS})`
    ),
    categories: q(`SELECT count(*) FROM categories WHERE name LIKE 'P12I-%'`),
    sessions: q(`SELECT count(*) FROM auth_sessions WHERE user_id IN ${TAG_USERS}`),
    rateLimitRows: q(`SELECT count(*) FROM auth_rate_limits WHERE key_hash IN ${inKeys(keys)}`),
  }
}

/** Deletes ONLY what is reachable from the `P12I` tag, children first. Safe to run repeatedly. */
export function cleanup(): { before: Record<string, number>; after: Record<string, number> } {
  const keys = rateLimitKeys()
  const before = countP12I(keys)
  psql(`
BEGIN;
DELETE FROM service_requests WHERE requester_id IN ${TAG_USERS} OR provider_listing_id IN ${TAG_LISTINGS};
DELETE FROM saved_items WHERE user_id IN ${TAG_USERS} OR listing_id IN ${TAG_LISTINGS};
DELETE FROM listings WHERE owner_id IN ${TAG_USERS};
DELETE FROM categories WHERE name LIKE 'P12I-%' AND parent_id IS NOT NULL;
DELETE FROM categories WHERE name LIKE 'P12I-%';
DELETE FROM professional_profiles WHERE user_id IN ${TAG_USERS};
DELETE FROM user_roles WHERE user_id IN ${TAG_USERS};
DELETE FROM auth_events WHERE user_id IN ${TAG_USERS};
DELETE FROM auth_tokens WHERE user_id IN ${TAG_USERS};
DELETE FROM auth_sessions WHERE user_id IN ${TAG_USERS};
DELETE FROM auth_identities WHERE user_id IN ${TAG_USERS};
DELETE FROM oauth_flows WHERE user_id IN ${TAG_USERS};
DELETE FROM auth_rate_limits WHERE key_hash IN ${inKeys(keys)};
DELETE FROM users WHERE email LIKE 'p12i.%';
COMMIT;`)
  return { before, after: countP12I(keys) }
}

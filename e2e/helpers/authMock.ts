import type { Page, Route } from '@playwright/test'
import { routeRead } from '../../src/test/fixtures/readRouter'
import { publicApprovedListings, resetWriteState, routeWrite, savedRows, writeState } from '../../src/test/fixtures/writeRouter'

/**
 * A deterministic stand-in for the FastAPI authentication endpoints (Phase 12C), installed per test
 * with `page.route`. The E2E suite runs the production build WITHOUT a backend, so — exactly like
 * the Vitest layer — the HTTP boundary is faked, but with the real contract: cookie-style session
 * state held "server side" (it survives page reloads, like an HttpOnly cookie), the real
 * `{data}` / `{error}` envelopes, `/auth/me` returning a CSRF token, CSRF enforced on authenticated
 * unsafe calls, and the documented status codes. Nothing here reaches Google or any real service.
 *
 * Phase 12G: the same object also answers every READ endpoint (public discovery and the signed-in
 * owner / admin / saved / request reads) from `src/test/fixtures/readRouter.ts` - the contract the
 * Vitest layer uses - and fulfils map tile requests with a 1x1 PNG, so no spec ever contacts
 * OpenStreetMap. `tileRequests` records every tile URL the page asked for.
 */

export const PASSWORD = 'correct horse battery'

export interface MockAccount {
  email: string
  displayName: string
  password: string
  emailVerified: boolean
  roles: string[]
  professional?: { planCode: 'free' | 'premium' }
  providers: string[]
}

export interface RecordedCall {
  method: string
  path: string
  body: unknown
  csrf: string | null
}

const GOOGLE_CONSENT_PATH = '/__fake-google/consent'

// A 1x1 transparent PNG: what every map tile request is answered with.
const BLANK_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

export class AuthMock {
  readonly accounts = new Map<string, MockAccount>()
  readonly calls: RecordedCall[] = []
  /** Every map-tile URL the page requested (answered locally, never from the network). */
  readonly tileRequests: string[] = []
  /** The "server session": which account is signed in, and its CSRF token. */
  session: { email: string; csrf: string } | null = null
  googleEnabled = true
  /** Where the fake Google consent page sends the browser back to (the frontend `returnTo`). */
  private googleReturnTo = '/'
  private csrfCounter = 0

  private readonly origin: string

  constructor(origin: string) {
    this.origin = origin
  }

  addAccount(account: Partial<MockAccount> & { email: string; displayName: string }): MockAccount {
    const full: MockAccount = {
      password: PASSWORD,
      emailVerified: true,
      roles: [],
      providers: [],
      ...account,
      email: account.email.toLowerCase(),
    }
    this.accounts.set(full.email, full)
    return full
  }

  /** The routes the frontend uses, answered from this object's state. */
  async install(page: Page): Promise<void> {
    resetWriteState()
    await page.route('**/api/v1/**', (route) => this.handle(route))
    await page.route('https://tile.openstreetmap.org/**', (route) => {
      this.tileRequests.push(route.request().url())
      return route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_TILE })
    })
    await page.route(`**${GOOGLE_CONSENT_PATH}**`, (route) => this.googleConsent(route))
  }

  private me(account: MockAccount, csrf: string) {
    return {
      id: `00000000-0000-4000-8000-${String(this.accounts.size).padStart(12, '0')}`,
      displayName: account.displayName,
      email: account.email,
      emailVerified: account.emailVerified,
      roles: account.roles,
      ...(account.professional && { professional: account.professional }),
      authMethods: { password: true, providers: account.providers },
      session: { expiresAt: '2099-01-01T00:00:00Z' },
      csrfToken: csrf,
    }
  }

  private startSession(account: MockAccount) {
    this.session = { email: account.email, csrf: `csrf-${++this.csrfCounter}` }
    return this.me(account, this.session.csrf)
  }

  private current(): MockAccount | null {
    return this.session ? (this.accounts.get(this.session.email) ?? null) : null
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '')
    const body = request.postData() ? (JSON.parse(request.postData()!) as Record<string, string>) : undefined
    const csrf = request.headers()['x-csrf-token'] ?? null
    this.calls.push({ method, path, body, csrf })

    const reply = (status: number, payload?: unknown) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      })
    const data = (value: unknown, status = 200) => reply(status, { data: value })
    const error = (status: number, code: string, details: unknown[] = []) =>
      reply(status, { error: { code, message: code, details, requestId: 'req-e2e' } })

    // Authenticated unsafe calls need the session AND its CSRF token (the backend middleware's rule).
    const sessionBound = new Set(['/auth/logout', '/auth/resend-verification'])
    if (method !== 'GET' && sessionBound.has(path)) {
      const account = this.current()
      if (!account) return error(401, 'unauthenticated')
      if (csrf !== this.session!.csrf) return error(403, 'csrf_failed')
    }

    switch (`${method} ${path}`) {
      case 'GET /auth/me': {
        const account = this.current()
        return account ? data(this.me(account, this.session!.csrf)) : error(401, 'unauthenticated')
      }
      case 'POST /auth/login': {
        const account = this.accounts.get(String(body?.email ?? '').trim().toLowerCase())
        if (!account || account.password !== body?.password) return error(401, 'invalid_credentials')
        return data(this.startSession(account))
      }
      case 'POST /auth/register': {
        const email = String(body?.email ?? '').trim().toLowerCase()
        if (this.accounts.has(email)) return error(409, 'email_already_registered')
        const account = this.addAccount({
          email,
          displayName: String(body?.displayName ?? ''),
          password: String(body?.password ?? ''),
          emailVerified: false,
        })
        return data(this.startSession(account), 201)
      }
      case 'POST /auth/logout':
      case 'POST /auth/logout-all':
        this.session = null
        return reply(204)
      case 'POST /auth/resend-verification':
        return reply(204)
      case 'POST /auth/verify-email': {
        const owner = [...this.accounts.values()].find((a) => `verify-${a.email}` === body?.token)
        if (!owner) return error(400, 'token_invalid')
        owner.emailVerified = true
        return reply(204)
      }
      case 'POST /auth/forgot-password':
        return data({ status: 'accepted' }, 202)
      case 'POST /auth/reset-password': {
        const owner = [...this.accounts.values()].find((a) => `reset-${a.email}` === body?.token)
        if (!owner) return error(400, 'token_invalid')
        owner.password = String(body?.newPassword ?? '')
        if (this.session?.email === owner.email) this.session = null // a reset revokes the sessions
        return reply(204)
      }
      case 'POST /auth/oauth/google/start': {
        if (!this.googleEnabled) return error(503, 'service_unavailable')
        this.googleReturnTo = String(body?.returnTo ?? '/')
        return data({ authorizationUrl: `${this.origin}${GOOGLE_CONSENT_PATH}?state=fake` })
      }
      default: {
        const account = this.current()
        const session = account
          ? { roles: account.roles, displayName: account.displayName, professional: Boolean(account.professional), emailVerified: account.emailVerified }
          : null
        // The professional profile is account state (like the real server's professional_profiles row): a verified
        // user creates it with an idempotent PUT (201 first, then 200), and /auth/me reports it from then on.
        if (method === 'PUT' && path === '/users/me/professional-profile') {
          if (!account || !this.session) return error(401, 'unauthenticated')
          if (!account.emailVerified) return error(403, 'email_not_verified')
          const first = !account.professional
          account.professional = { planCode: 'free' }
          return data(this.me(account, this.session.csrf), first ? 201 : 200)
        }
        // Writes first (they also handle the mutable state the subsequent reads see).
        const write = routeWrite(method, path, body ?? {}, session)
        if (write) return reply(write.status, write.body)
        // Read endpoints that would normally come from the static fixtures: for /saved, /users/me/listings
        // and /admin/listings we return the MUTABLE state so writes are observable on the next read.
        const url = new URL(request.url())
        if (method === 'GET' && path === '/saved' && account) {
          const rows = savedRows()
          return reply(200, { data: rows, meta: { total: rows.length, limit: 50, offset: 0 } })
        }
        // Keep /requests and /users/me/leads on the MUTABLE state so a POST / action is immediately visible.
        if (method === 'GET' && (path === '/requests' || path === '/users/me/leads') && account) {
          const rows = path === '/requests' ? writeState().myRequests : writeState().leads
          const status = url.searchParams.get('status')
          const filtered = status ? rows.filter((r) => r.status === status) : rows
          return reply(200, { data: filtered, meta: { total: filtered.length, limit: 50, offset: 0 } })
        }
        if (method === 'GET') {
          const requestDetail = /^\/requests\/(.+)$/.exec(path)
          if (requestDetail && account) {
            const id = decodeURIComponent(requestDetail[1])
            const found = writeState().myRequests.find((r) => r.id === id) ?? writeState().leads.find((r) => r.id === id)
            if (found) {
              const lead = writeState().leads.find((r) => r.id === id)
              return reply(200, { data: { ...found, requesterName: lead?.requesterName ?? account.displayName, viewerRole: lead ? 'provider' : 'requester', history: (writeState().history[id] ?? []) } })
            }
            return error(404, 'not_found')
          }
        }
        // Public detail / search should see listings the admin approved during the test, in addition to
        // the static public fixtures: fall back to the mutable approved set for ids the readRouter does not know.
        if (method === 'GET') {
          const detail = /^\/listings\/(.+)$/.exec(path)
          if (detail) {
            const id = decodeURIComponent(detail[1])
            const fromMutable = publicApprovedListings().find((l) => l.id === id)
            // Let readRouter answer first for its own fixtures; only step in when it would 404.
            const readFirst = routeRead(method, path, url.searchParams, session)
            if (readFirst && readFirst.status !== 404) return reply(readFirst.status, readFirst.body)
            if (fromMutable) return reply(200, { data: fromMutable })
          }
          if (path === '/search' || path === '/search/suggestions') {
            // Augment: run the read router over the mutable approved listings too, so a freshly approved
            // listing is findable by text search.
            const readFirst = routeRead(method, path, url.searchParams, session)
            if (readFirst) return reply(readFirst.status, readFirst.body)
          }
        }
        if (method === 'GET' && path === '/users/me/listings' && account) {
          const rows = writeState().listings
          return reply(200, {
            data: rows,
            meta: { total: rows.length, limit: 50, offset: 0, counts: rows.reduce((c, l) => ({ ...c, [l.status]: (c[l.status as keyof typeof c] ?? 0) + 1 }), { pending: 0, approved: 0, rejected: 0, archived: 0 }) },
          })
        }
        // Admin category reads use the mutable state so a POST / PATCH / reorder is immediately visible.
        if (method === 'GET' && path === '/admin/categories' && (account?.roles ?? []).includes('admin')) {
          const module = url.searchParams.get('module')
          const rows = writeState().categories.filter((c) => !module || c.module === module)
          return reply(200, { data: rows })
        }
        if (method === 'GET' && path === '/admin/listings' && (account?.roles ?? []).includes('admin')) {
          // Only non-archived listings go on the moderation queue (matching the ADMIN_LISTINGS fixture used by the read tests).
          const all = writeState().listings.filter((l) => l.status !== 'archived')
          const filterStatus = url.searchParams.get('status')
          const rows = filterStatus ? all.filter((l) => l.status === filterStatus) : all
          const summaries = rows.map((l) => ({
            id: l.id,
            kind: l.kind,
            ...(l.kind === 'business' ? { vertical: l.vertical } : {}),
            title: l.kind === 'property' ? l.title : l.name,
            area: l.area,
            ...(l.location.block ? { block: l.location.block } : {}),
            locationVisibility: l.location.visibility,
            categoryLabel: l.categoryLabel,
            status: l.status,
            revision: l.revision,
            submittedAt: l.submittedAt,
            updatedAt: l.updatedAt,
          }))
          // `counts` is always over the WHOLE queue, not the filtered subset (API_CONTRACT §10.2).
          return reply(200, {
            data: summaries,
            meta: { total: rows.length, limit: 50, offset: 0, counts: all.reduce((c, l) => ({ ...c, [l.status]: (c[l.status as keyof typeof c] ?? 0) + 1 }), { pending: 0, approved: 0, rejected: 0, archived: 0 }) },
          })
        }
        if (method === 'GET') {
          const admin = /^\/admin\/listings\/(.+)$/.exec(path)
          if (admin && (account?.roles ?? []).includes('admin')) {
            const row = writeState().listings.find((l) => l.id === decodeURIComponent(admin[1]))
            if (row) return reply(200, { data: { ...row, submitter: { displayName: 'Sana Owner' }, history: [{ action: 'submitted', toStatus: 'pending', revision: 1, actor: { displayName: 'Sana Owner', role: 'owner' }, createdAt: row.submittedAt }] } })
            return error(404, 'not_found')
          }
          const ownerDetail = /^\/users\/me\/listings\/(.+)$/.exec(path)
          if (ownerDetail && account) {
            const row = writeState().listings.find((l) => l.id === decodeURIComponent(ownerDetail[1]))
            if (row) return reply(200, { data: row })
            return error(404, 'not_found')
          }
        }
        const read = routeRead(method, path, url.searchParams, session)
        return read ? reply(read.status, read.body) : error(404, 'not_found')
      }
    }
  }

  /** Plays the part of Google + the backend callback: sign in as the Google account, redirect home. */
  private async googleConsent(route: Route): Promise<void> {
    const account =
      this.accounts.get('google.user@example.org') ??
      this.addAccount({
        email: 'google.user@example.org',
        displayName: 'Google User',
        providers: ['google'],
        password: '',
      })
    this.startSession(account)
    await route.fulfill({ status: 302, headers: { location: this.googleReturnTo } })
  }
}

import type { Page, Route } from '@playwright/test'

/**
 * A deterministic stand-in for the FastAPI authentication endpoints (Phase 12C), installed per test
 * with `page.route`. The E2E suite runs the production build WITHOUT a backend, so — exactly like
 * the Vitest layer — the HTTP boundary is faked, but with the real contract: cookie-style session
 * state held "server side" (it survives page reloads, like an HttpOnly cookie), the real
 * `{data}` / `{error}` envelopes, `/auth/me` returning a CSRF token, CSRF enforced on authenticated
 * unsafe calls, and the documented status codes. Nothing here reaches Google or any real service.
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

export class AuthMock {
  readonly accounts = new Map<string, MockAccount>()
  readonly calls: RecordedCall[] = []
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
    await page.route('**/api/v1/**', (route) => this.handle(route))
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
      default:
        return error(404, 'not_found')
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

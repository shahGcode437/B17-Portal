import { expect, test, type Page } from '@playwright/test'
import { PASSWORD, TAG, WEB, emailFor, expectH1, newContext, scalar } from './helpers/stack'

/**
 * Phase 12S: the SAME-ORIGIN runtime. A person may open the app at `localhost` or at `127.0.0.1`; both must
 * register, log in, survive a reload and log out - against the REAL API and database, with real cookies.
 *
 * Before 12S the page at `localhost:5173` called `127.0.0.1:8000` directly: a cross-site request, refused by
 * the backend's Sec-Fetch-Site / Origin check with `csrf_failed` ("We couldn't verify that request"). Now the
 * browser only ever talks to its own origin and Vite proxies `/api`. Nothing in the backend was loosened - the
 * last test proves the cross-site request is STILL refused.
 */
const ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'] as const

for (const origin of ORIGINS) {
  const host = new URL(origin).hostname
  test.describe(`auth at ${origin}`, () => {
    test.describe.configure({ mode: 'serial' })
    const email = emailFor(`origin-${host.replace(/\W/g, '')}`)
    const name = `${TAG} origin ${host}`
    let page: Page
    let sawPort8000 = false
    const apiCalls: { method: string; url: string; status?: number }[] = []

    test.beforeAll(async ({ browser }) => {
      const context = await newContext(browser, { baseURL: origin })
      page = await context.newPage()
      page.on('request', (r) => {
        if (r.url().includes(':8000')) sawPort8000 = true
      })
      page.on('response', (r) => {
        if (r.url().includes('/api/v1/')) apiCalls.push({ method: r.request().method(), url: r.url(), status: r.status() })
      })
    })
    test.afterAll(async () => {
      await page.context().close()
    })

    test('register works: 201, signed in, a host-only HttpOnly session cookie', async () => {
      await page.goto('/register')
      await expectH1(page, 'Create Account')
      await page.getByLabel('Your name').fill(name)
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
      await page.getByRole('button', { name: 'Create Account', exact: true }).click()
      await expect(page.getByRole('banner').getByText(name)).toBeVisible()

      const register = apiCalls.find((c) => c.method === 'POST' && c.url.endsWith('/auth/register'))!
      expect(register.url).toBe(`${origin}/api/v1/auth/register`) // the page's OWN origin
      expect(register.status).toBe(201)
      expect(await page.getByRole('alert').allInnerTexts()).not.toContain("We couldn't verify that request. Please refresh the page and try again.")

      const cookies = (await page.context().cookies(origin)).filter((c) => c.name.endsWith('session'))
      expect(cookies).toHaveLength(1)
      expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: false, domain: host })
      expect(scalar(`SELECT count(*) FROM users WHERE email = '${email}'`)).toBe('1')
    })

    test('authenticated reload keeps the session; /auth/me answers on the page origin', async () => {
      await page.goto('/profile')
      await page.reload()
      await expectH1(page, name)
      const me = await page.request.get(`${origin}/api/v1/auth/me`)
      expect(me.status()).toBe(200)
      expect((await me.json()).data.email).toBe(email)
    })

    test('a write carries the CSRF token and succeeds (resend verification: 204)', async () => {
      await page.goto('/profile')
      await expect(page.getByRole('region', { name: 'Email verification' })).toBeVisible()
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/auth/resend-verification')),
        page.getByRole('button', { name: 'Resend verification email' }).click(),
      ])
      expect(response.status()).toBe(204)
      expect(response.request().headers()['x-csrf-token']).toBeTruthy()
    })

    test('logout works: signed out, the session is revoked, private pages redirect', async () => {
      await page.goto('/profile')
      await page.getByRole('button', { name: 'Log Out' }).click()
      await expectH1(page, 'Log In')
      expect((await page.request.get(`${origin}/api/v1/auth/me`)).status()).toBe(401)
      await page.goto('/profile/saved')
      await expectH1(page, 'Log In')
      expect(scalar(`SELECT count(*) FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE email = '${email}') AND revoked_at IS NULL`)).toBe('0')
    })

    test('login works again from the Log In form, and a wrong password says so', async () => {
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Password', { exact: true }).fill('definitely the wrong password')
      await page.getByRole('button', { name: 'Log In', exact: true }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' })).toBeVisible()

      await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
      await page.getByRole('button', { name: 'Log In', exact: true }).click()
      await expect(page.getByRole('banner').getByText(name)).toBeVisible()
      await page.reload()
      await expect(page.getByRole('banner').getByText(name)).toBeVisible()
    })

    test('the browser never talked to the API port directly (everything went through the page origin)', async () => {
      expect(sawPort8000).toBe(false)
      expect(apiCalls.length).toBeGreaterThan(5)
      for (const call of apiCalls) expect(call.url.startsWith(`${origin}/api/v1/`), call.url).toBe(true)
      expect(apiCalls.filter((c) => (c.status ?? 0) >= 500)).toEqual([])
    })
  })
}

test.describe('CSRF and origin checks are NOT weakened', () => {
  test('a cross-site request from a localhost page straight to 127.0.0.1:8000 is still refused (csrf_failed)', async ({ browser }) => {
    const context = await newContext(browser, { baseURL: 'http://localhost:5173' })
    const page = await context.newPage()
    await page.goto('/login')
    await expectH1(page, 'Log In')
    // This is exactly what the app used to do. The backend must keep saying no.
    const result = await page.evaluate(async () => {
      const response = await fetch('http://127.0.0.1:8000/api/v1/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.org', password: 'whatever it is it is long' }),
      })
      return { status: response.status, body: (await response.json()) as { error?: { code: string } } }
    })
    expect(result.status).toBe(403)
    expect(result.body.error?.code).toBe('csrf_failed')
    await context.close()
  })

  test('an unsafe request with a session but no CSRF token, or with a foreign Origin, is refused', async ({ browser }) => {
    const context = await newContext(browser, { baseURL: WEB })
    const page = await context.newPage()
    const email = emailFor('csrf-check')
    await page.goto('/register')
    await page.getByLabel('Your name').fill(`${TAG} csrf`)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Create Account', exact: true }).click()
    await expect(page.getByRole('banner').getByText(`${TAG} csrf`)).toBeVisible()

    const noToken = await page.request.post(`${WEB}/api/v1/auth/resend-verification`, { headers: { Origin: WEB } })
    expect(noToken.status()).toBe(403)
    expect((await noToken.json()).error.code).toBe('csrf_failed')
    const foreign = await page.request.post(`${WEB}/api/v1/auth/resend-verification`, { headers: { Origin: 'http://evil.example', 'X-CSRF-Token': 'x' } })
    expect(foreign.status()).toBe(403)
    await context.close()
  })
})

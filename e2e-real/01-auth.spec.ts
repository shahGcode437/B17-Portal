import { expect, test } from '@playwright/test'
import { PASSWORD, TAG, emailFor, expectH1, scalar, verificationToken } from './helpers/stack'

/**
 * Auth through the REAL stack (journey §6): anonymous -> register -> verification state -> verify ->
 * login -> authenticated reload -> logout -> login again. Authority is the server's `/auth/me`; the
 * browser holds a session COOKIE only (HttpOnly) - no JWT, no token in web storage, no CSRF token at rest.
 */
test.describe.configure({ mode: 'serial' })

const email = emailFor('auth')
const name = `${TAG} auth`

async function browserStorage(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    local: { ...window.localStorage },
    session: { ...window.sessionStorage },
    cookie: document.cookie,
  }))
}

test('anonymous visitor: public pages open, private pages ask for login, nothing private is shown', async ({ page }) => {
  await page.goto('/profile/saved')
  await expectH1(page, 'Log In')
  await page.goto('/provider/listings')
  await expectH1(page, 'Log In')
  await page.goto('/admin/moderation')
  await expect(page.getByRole('heading', { level: 1, name: /Admin Login|Log In/ })).toBeVisible()
  const me = await page.request.get('http://127.0.0.1:8000/api/v1/auth/me')
  expect(me.status()).toBe(401)
})

test('register through the real form: the account is created unverified and the notice says so', async ({ page }) => {
  await page.goto('/register')
  await expectH1(page, 'Create Account')
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create Account', exact: true }).click()
  // Registration signs the new account in (cookie session) and shows the verification reminder.
  await expect(page.getByRole('banner').getByText(name)).toBeVisible()
  await page.goto('/profile')
  await expect(page.getByRole('region', { name: 'Email verification' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resend verification email' })).toBeVisible()

  expect(scalar(`SELECT email_verified_at IS NULL FROM users WHERE email = '${email}'`)).toBe('t')
  // The password is stored as a hash, never in the clear.
  const hash = scalar(`SELECT password_hash FROM users WHERE email = '${email}'`)
  expect(hash).not.toContain(PASSWORD)
  expect(hash.length).toBeGreaterThan(30)
})

test('verification state: an unverified account is told to verify before the Professional area', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toHaveCount(0)
  await page.goto('/profile')
  await expect(page.getByRole('region', { name: 'Email verification' })).toBeVisible()
  // The server (not the notice) refuses verified-only work: creating the profile needs a verified e-mail.
  await page.goto('/provider/listings/new')
  await page.getByRole('button', { name: 'Create a professional profile' }).click()
  await expect(page.getByRole('alert')).toContainText(/verify your email/i)
  expect(scalar(`SELECT count(*) FROM professional_profiles WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`)).toBe('0')
})

test('verify with the e-mailed link, then log in, reload, log out and log in again', async ({ page, context }) => {
  const token = await verificationToken(email)
  await page.goto(`/verify-email#token=${token}`)
  await expect(page.getByText(/verified/i).first()).toBeVisible()
  expect(scalar(`SELECT email_verified_at IS NOT NULL FROM users WHERE email = '${email}'`)).toBe('t')
  // The token is single-use: the link no longer works.
  await page.goto('/')
  await page.goto(`/verify-email#token=${token}`)
  await expect(page.getByText('This verification link is invalid or has already been used.')).toBeVisible()

  // Log in through the form.
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toHaveCount(0)

  // /auth/me is the authority and the browser holds only an HttpOnly cookie.
  const meResponse = await page.request.get('http://127.0.0.1:8000/api/v1/auth/me')
  expect(meResponse.status()).toBe(200)
  const me = (await meResponse.json()).data
  expect(me.emailVerified).toBe(true)
  expect(me.roles ?? []).not.toContain('admin')
  const cookies = (await context.cookies('http://127.0.0.1:8000')).filter((c) => c.httpOnly)
  expect(cookies.length).toBeGreaterThan(0)
  const storage = await browserStorage(page)
  const everything = JSON.stringify(storage)
  expect(everything).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/) // no JWT
  expect(everything).not.toContain(me.csrfToken) // CSRF lives in memory only
  for (const c of cookies) expect(storage.cookie).not.toContain(c.name) // the session cookie is invisible to scripts
  expect(Object.keys(storage.local).concat(Object.keys(storage.session)).join(' ')).not.toMatch(/token|session|auth|plan|role|resident/i)

  // Authenticated reload: the session survives (cookie), the UI rehydrates from /auth/me.
  await page.goto('/profile/saved')
  await expectH1(page, 'Saved')
  await page.reload()
  await expectH1(page, 'Saved')

  // Logout clears the authenticated UI and the private page asks for login again.
  await page.goto('/profile')
  await expectH1(page, /./)
  const liveBefore = Number(scalar(`SELECT count(*) FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE email='${email}') AND revoked_at IS NULL`))
  await page.getByRole('button', { name: 'Log Out' }).click()
  await expect(page.getByRole('banner').getByText(name)).toHaveCount(0)
  expect((await page.request.get('http://127.0.0.1:8000/api/v1/auth/me')).status()).toBe(401)
  await page.goto('/profile/saved')
  await expectH1(page, 'Log In')
  expect(JSON.stringify(await browserStorage(page))).not.toContain(me.csrfToken)
  // Logout revokes THIS session on the server (earlier tests' sessions are untouched).
  expect(Number(scalar(`SELECT count(*) FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE email='${email}') AND revoked_at IS NULL`))).toBe(liveBefore - 1)

  // And log in again.
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expectH1(page, 'Saved')
  expect(Number(scalar(`SELECT count(*) FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE email='${email}') AND revoked_at IS NULL`))).toBe(liveBefore)
})

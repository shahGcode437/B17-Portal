import { expect, test, mockFor } from './helpers/test'
import { PASSWORD } from './helpers/authMock'
import { emailFor, expectPage, openApp, signIn } from './helpers/app'

/**
 * Real-auth journeys (Phase 12C), against the mock backend (`e2e/helpers/authMock.ts`): the
 * production build runs without an API, so the HTTP boundary is faked with the real contract —
 * server-side session surviving reloads, `/auth/me`, CSRF, the `{data}` / `{error}` envelopes. No
 * Google, no tokens in screenshots, no arbitrary waits: every step waits on something visible.
 */

const headerAccount = (page: import('@playwright/test').Page, name: RegExp | string) =>
  page.getByRole('banner').getByRole('link', { name })

test('anonymous bootstrap: /auth/me is asked once, the visitor sees "Log in", nothing is sent as a credential', async ({ page }) => {
  const mock = mockFor(page)

  await openApp(page, '/')

  await expect(headerAccount(page, /log in/i)).toBeVisible()
  const me = mock.calls.filter((call) => call.path === '/auth/me')
  expect(me).toHaveLength(1)
  expect(me[0].csrf).toBeNull()
})

test('login with the real form, then a reload restores the session through /auth/me', async ({ page }) => {
  const mock = mockFor(page)
  mock.addAccount({ email: emailFor('Ayesha Khan'), displayName: 'Ayesha Khan' })
  await openApp(page, '/login', 'Log In')

  await signIn(page, 'Ayesha Khan', 'resident')
  await expectPage(page)
  await expect(headerAccount(page, /ayesha khan/i)).toBeVisible()

  await page.reload()
  await expectPage(page)
  await expect(headerAccount(page, /ayesha khan/i)).toBeVisible()
  expect(mock.calls.filter((call) => call.path === '/auth/me').length).toBeGreaterThanOrEqual(2)
  // Nothing auth-related is kept in the page's web storage.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(stored).not.toMatch(/csrf|password|session|token/i)
})

test('wrong password: one generic message, still logged out', async ({ page }) => {
  const mock = mockFor(page)
  mock.addAccount({ email: 'known@example.org', displayName: 'Known' })
  await openApp(page, '/login', 'Log In')

  await page.getByLabel('Email').fill('known@example.org')
  await page.getByLabel('Password', { exact: true }).fill('not the password')
  await page.getByRole('button', { name: 'Log In', exact: true }).click()

  await expect(page.getByText('Incorrect email or password.')).toBeVisible()
  await expect(headerAccount(page, /log in/i)).toBeVisible()
})

test('logout revokes the server session: a reload stays logged out', async ({ page }) => {
  const mock = mockFor(page)
  await openApp(page, '/login', 'Log In')
  await signIn(page, 'Ayesha Khan', 'resident')
  await expectPage(page)
  await page.goto('/profile')
  await expectPage(page, 'Ayesha Khan')

  await page.getByRole('button', { name: 'Log Out' }).click()

  await expectPage(page)
  await expect(headerAccount(page, /log in/i)).toBeVisible()
  expect(mock.session).toBeNull()
  const logout = mock.calls.find((call) => call.path === '/auth/logout')
  expect(logout?.csrf).toMatch(/^csrf-/) // the in-memory token was sent
  await page.reload()
  await expect(headerAccount(page, /log in/i)).toBeVisible()
})

test('a protected page sends a visitor to Log In and back, and survives a reload once signed in', async ({ page }) => {
  await page.goto('/profile/requests')
  await expectPage(page, 'Log In')

  await signIn(page, 'Ayesha Khan', 'resident')

  await expect(page).toHaveURL(/\/profile\/requests$/)
  await page.reload()
  await expect(page).toHaveURL(/\/profile\/requests$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
})

test('registration signs in an UNVERIFIED account: a notice, a neutral resend, and verification via the e-mail link', async ({ page }) => {
  const mock = mockFor(page)
  await openApp(page, '/register', 'Create Account')

  await page.getByLabel('Your name').fill('Nadia New')
  await page.getByLabel('Email').fill('nadia.new@example.org')
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create Account', exact: true }).click()
  await expectPage(page)
  await expect(headerAccount(page, /nadia new/i)).toBeVisible()
  const register = mock.calls.find((call) => call.path === '/auth/register')
  expect(Object.keys(register!.body as object).sort()).toEqual(['displayName', 'email', 'password'])

  await page.goto('/profile')
  await expect(page.getByRole('region', { name: 'Email verification' })).toBeVisible()
  await page.getByRole('button', { name: 'Resend verification email' }).click()
  await expect(page.getByText(/if your email still needs verifying/i)).toBeVisible()

  // The e-mail link: the token is in the FRAGMENT, which the app removes from the address bar.
  await page.goto('/verify-email#token=verify-nadia.new@example.org')
  await expect(page.getByText('Your email address is verified.')).toBeVisible()
  expect(page.url()).not.toContain('#')
  expect(page.url()).not.toContain('verify-nadia')
  await page.goto('/profile')
  await expectPage(page, 'Nadia New')
  await expect(page.getByRole('region', { name: 'Email verification' })).toHaveCount(0)
})

test('an invalid verification link is reported without leaving the token in the URL', async ({ page }) => {
  await page.goto('/verify-email#token=garbage')

  await expect(page.getByText(/invalid or has already been used/i)).toBeVisible()
  expect(page.url()).not.toContain('garbage')
})

test('forgot password gives the same neutral answer for any address', async ({ page }) => {
  await openApp(page, '/forgot-password', 'Forgot password')

  await page.getByLabel('Email').fill('nobody-at-all@example.org')
  await page.getByRole('button', { name: 'Send reset link' }).click()

  await expect(page.getByRole('status').filter({ hasText: /if an account exists/i })).toBeVisible()
})

test('reset password: the token leaves the URL at once, the reset does NOT log in, the new password works', async ({ page }) => {
  const mock = mockFor(page)
  mock.addAccount({ email: 'reset.me@example.org', displayName: 'Reset Me' })

  await page.goto('/reset-password#token=reset-reset.me@example.org')
  await expectPage(page, 'Reset password')
  expect(page.url()).not.toContain('#')
  expect(page.url()).not.toContain('reset-reset')

  await page.getByLabel('New password', { exact: true }).fill('a brand new passphrase')
  await page.getByLabel('Confirm new password').fill('a brand new passphrase')
  await page.getByRole('button', { name: 'Set new password' }).click()
  await expect(page.getByText(/your password has been changed/i)).toBeVisible()
  expect(mock.session).toBeNull() // no local or server session was created
  await expect(headerAccount(page, /log in/i)).toBeVisible()

  await page.getByRole('link', { name: 'Go to log in' }).click()
  await expectPage(page, 'Log In')
  await page.getByLabel('Email').fill('reset.me@example.org')
  await page.getByLabel('Password', { exact: true }).fill('a brand new passphrase')
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expect(headerAccount(page, /reset me/i)).toBeVisible()
})

test('Google sign-in: the app starts the flow, the browser leaves for the provider, and /auth/me finishes it', async ({ page }) => {
  const mock = mockFor(page)
  await openApp(page, '/login', 'Log In')

  await page.getByRole('button', { name: 'Continue with Google' }).click()

  // (The fake consent route plays Google + the backend callback and redirects home — never real Google.)
  await expect(headerAccount(page, /google user/i)).toBeVisible()
  const start = mock.calls.find((call) => call.path === '/auth/oauth/google/start')
  expect(start?.body).toMatchObject({ purpose: 'login' })
  expect(start?.csrf).toBeNull() // pre-session
  expect(page.url()).not.toMatch(/state=|code=/) // no provider values left in the address bar
})

test('Google sign-in when the backend has it switched off says so plainly', async ({ page }) => {
  mockFor(page).googleEnabled = false
  await openApp(page, '/login', 'Log In')

  await page.getByRole('button', { name: 'Continue with Google' }).click()

  await expect(page.getByText(/google sign-in isn't available/i)).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('a failed Google sign-in comes back as a safe message and the error is removed from the URL', async ({ page }) => {
  await page.goto('/login?error=identity_conflict')

  await expect(page.getByText(/existing email and password/i)).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('an unknown ?error= value is never echoed back', async ({ page }) => {
  await page.goto('/login?error=%3Cimg%20src%3Dx%3E')

  await expect(page.getByText(/couldn't complete google sign-in/i)).toBeVisible()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await expect(page).toHaveURL(/\/login$/)
})

test('Admin comes only from the backend roles: an admin account sees the dashboard, a resident is refused', async ({ page }) => {
  await page.goto('/admin')
  await expectPage(page, 'Admin Login')
  await signIn(page, 'Root Admin', 'admin')
  await expectPage(page, 'Admin Dashboard')
  await page.getByRole('button', { name: 'Log out' }).click()
  await expectPage(page, 'Admin Login')

  await signIn(page, 'Plain Resident', 'resident')
  await expect(page.getByText(/isn't an administrator account/i)).toBeVisible()
})

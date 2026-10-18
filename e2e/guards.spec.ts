import { expect, test } from './helpers/test'
import { enterAdmin } from './helpers/workspace'
import { expectPage, openApp, pushInApp, signIn } from './helpers/app'

/**
 * Route guards (Phase 12C). They are UX gating over the REAL auth state machine (loading →
 * anonymous | authenticated, from `/auth/me`) — the API stays the authority. The tests pin the
 * behavior users rely on: private areas send a signed-out visitor to the right login and return them
 * afterwards, and roles / the professional capability come only from the backend's `/auth/me`.
 */
test.describe('signed-out visitors', () => {
  for (const [path, label] of [
    ['/provider', 'the Professional workspace'],
    ['/provider/listings', 'My Listings'],
    ['/provider/listings/new', 'Create Listing'],
    ['/profile', 'the resident profile'],
    ['/profile/saved', 'Saved'],
    ['/profile/requests', 'My Requests'],
  ] as const) {
    test(`${path} (${label}) redirects to Log In and returns after signing in`, async ({ page }) => {
      await page.goto(path)
      await expectPage(page, 'Log In')
      await expect(page).toHaveURL(/\/login$/)
      await signIn(page, 'Ayesha Khan')
      await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}$`))
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { name: 'Log In', level: 1 })).toHaveCount(0)
    })
  }

  for (const path of ['/admin', '/admin/moderation', '/admin/content']) {
    test(`${path} redirects to Admin Login`, async ({ page }) => {
      await page.goto(path)
      await expectPage(page, 'Admin Login')
      await expect(page).toHaveURL(/\/admin\/login$/)
    })
  }

  test('Admin Login returns to the page the admin was trying to open', async ({ page }) => {
    await page.goto('/admin/moderation')
    await expectPage(page, 'Admin Login')
    await signIn(page, 'Demo Admin', 'admin')
    await expectPage(page, 'Listing Review')
    await expect(page).toHaveURL(/\/admin\/moderation$/)
  })
})

test.describe('roles are separate', () => {
  test('a signed-in resident is told /admin is for administrators only', async ({ page }) => {
    await openApp(page, '/login', 'Log In')
    await signIn(page, 'Ayesha Khan', 'resident')
    await expectPage(page)
    await pushInApp(page, '/admin')
    await expectPage(page, 'Admin access only')
  })

  test('a professional account is not an administrator either', async ({ page }) => {
    await openApp(page, '/login', 'Log In')
    await signIn(page, 'Sana Baker', 'professional')
    await expectPage(page)
    await pushInApp(page, '/admin/moderation')
    await expectPage(page, 'Admin access only')
  })

  test('an account without a professional profile cannot open the Professional workspace', async ({ page }) => {
    await openApp(page, '/login', 'Log In')
    await signIn(page, 'Ayesha Khan', 'resident')
    await expectPage(page)
    await pushInApp(page, '/provider')
    await expectPage(page, 'Professional profile needed')
  })

  test('an admin account (roles from /auth/me) does not thereby get the Professional workspace', async ({ page }) => {
    await openApp(page, '/')
    await enterAdmin(page)
    await pushInApp(page, '/provider')
    await expectPage(page, 'Professional profile needed')
  })

  test('the public site never links to the Admin area', async ({ page }) => {
    await openApp(page, '/')
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  })
})

test('logging out of Admin returns to Admin Login on the next admin page', async ({ page }) => {
  await openApp(page, '/')
  await enterAdmin(page)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expectPage(page, 'Admin Login')
})

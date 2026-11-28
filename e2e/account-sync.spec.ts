import type { Page } from '@playwright/test'
import type { AuthMock } from './helpers/authMock'
import { expect, openSecondTab, test } from './helpers/test'
import { emailFor, expectPage, navigateInApp, openApp, signIn } from './helpers/app'
import { enterAdmin } from './helpers/workspace'

/**
 * Two real tabs of one browser context: they share the sign-in (the mock's one server session, as
 * they would share the cookie) and Chromium's own `BroadcastChannel` joins them. SECURITY
 * (GROCERY-4A, `docs/backend/AUTH_RBAC.md` §23.2). The API is the mock: this says nothing about a
 * real backend.
 */
const AYESHA = emailFor('Ayesha Khan')
const BILAL = emailFor('Bilal Ahmed')

/** Tab 1 on Ayesha's private order list, with one order of hers and one of Bilal's on the server. */
async function ayeshaOnHerOrders(page: Page, authMock: AuthMock) {
  authMock.addAccount({ email: BILAL, displayName: 'Bilal Ahmed' })
  await openApp(page, '/login', 'Log In')
  await signIn(page, 'Ayesha Khan', 'resident')
  await expectPage(page)
  const hers = authMock.grocery.seed(AYESHA).reference
  const his = authMock.grocery.seed(BILAL).reference
  await navigateInApp(page, '/profile/grocery', 'My Grocery Orders')
  await expect(page.getByRole('main')).toContainText(hers)
  return { hers, his }
}

async function secondTab(first: Page, path: string, heading: string) {
  const second = await openSecondTab(first)
  await openApp(second, path, heading)
  return second
}

test('signing out in one tab signs the other out and takes its private page away', async ({ page, authMock }) => {
  const { hers } = await ayeshaOnHerOrders(page, authMock)
  const second = await secondTab(page, '/profile', 'Ayesha Khan')

  await second.getByRole('button', { name: 'Log out' }).click()

  // Nothing is pressed in the first tab.
  await expectPage(page, 'Log In')
  await expect(page.locator('body')).not.toContainText(hers)
})

test('another account taking over in a second tab (as a Google return does) replaces the first tab', async ({ page, authMock }) => {
  const { hers, his } = await ayeshaOnHerOrders(page, authMock)

  authMock.session = { email: BILAL, csrf: 'csrf-bilal-other-tab' }
  await secondTab(page, '/profile/grocery', 'My Grocery Orders') // loads signed in, and says so

  await expect(page.getByText("You're now signed in as a different account")).toBeVisible()
  await expect(page.getByRole('main')).toContainText(his)
  await expect(page.locator('body')).not.toContainText(hers)
})

test('signing out and in as someone else in the second tab carries nothing over', async ({ page, authMock }) => {
  const { hers, his } = await ayeshaOnHerOrders(page, authMock)
  const second = await secondTab(page, '/profile', 'Ayesha Khan')
  await second.getByRole('button', { name: 'Log out' }).click()
  await expectPage(page, 'Log In')

  await navigateInApp(second, '/login', 'Log In')
  await signIn(second, 'Bilal Ahmed', 'resident')

  // The first tab follows, to the page it was sent to Log In from, as Bilal.
  await expectPage(page, 'My Grocery Orders')
  await expect(page.getByRole('main')).toContainText(his)
  await expect(page.locator('body')).not.toContainText(hers)
})

test('with no signal at all, another account’s records are not shown while it can’t be confirmed', async ({ page, authMock }) => {
  // A browser without BroadcastChannel: nothing tells this tab that the sign-in changed.
  await page.addInitScript(() => Object.defineProperty(window, 'BroadcastChannel', { value: undefined }))
  const { hers, his } = await ayeshaOnHerOrders(page, authMock)

  authMock.session = { email: BILAL, csrf: 'csrf-bilal-elsewhere' }
  const release = authMock.holdMe() // the confirmation is slow: Bilal's list has already arrived
  const listed = () => authMock.calls.filter((call) => call.method === 'GET' && call.path === '/grocery/orders').length
  const before = listed()
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(listed).toBeGreaterThan(before)
  await expect.poll(() => authMock.calls.at(-1)?.path).toBe('/auth/me')
  await expect(page.locator('body')).not.toContainText(his)

  release()
  await expect(page.getByText("You're now signed in as a different account")).toBeVisible()
  await expect(page.getByRole('main')).toContainText(his) // now it is his screen
  await expect(page.locator('body')).not.toContainText(hers)
})

test('told of a change while the server is out of reach: covered until it answers', async ({ page, authMock }) => {
  const { hers } = await ayeshaOnHerOrders(page, authMock)
  const second = await secondTab(page, '/', 'B-17 Portal')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  authMock.meUnreachable = true
  await second.evaluate(() => new BroadcastChannel('b17-auth').postMessage({ type: 'b17:auth-changed' }))

  const cover = page.getByRole('alertdialog')
  await expect(cover).toContainText("We couldn't check who is signed in")
  await expect(page.getByText(hers)).not.toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(hers) })).toHaveCount(0) // gone for a screen reader too

  authMock.meUnreachable = false
  await cover.getByRole('button', { name: 'Try again' }).click()

  await expect(cover).toHaveCount(0)
  await expect(page.getByRole('main')).toContainText(hers)
})

test('the same admin signing in again elsewhere keeps what was typed, and the change is sent once', async ({ page, authMock }) => {
  await openApp(page, '/')
  await enterAdmin(page)
  await navigateInApp(page, '/admin/categories', 'Categories')
  await page.getByRole('button', { name: 'Add a Services category' }).click()
  await page.getByLabel('New Services category name').fill('Rooftop gardening')

  authMock.session = { email: authMock.session!.email, csrf: 'csrf-signed-in-again' }
  const asked = () => authMock.calls.filter((call) => call.path === '/auth/me').length
  const before = asked()
  await secondTab(page, '/', 'B-17 Portal')
  await expect.poll(asked).toBeGreaterThanOrEqual(before + 2) // the new tab's own, and the first tab's check

  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByLabel('New Services category name')).toHaveValue('Rooftop gardening')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Category added')).toBeVisible()

  const sent = authMock.calls.filter((call) => call.method === 'POST' && call.path === '/admin/categories')
  expect(sent.map((call) => call.csrf)).toEqual(['csrf-signed-in-again'])
})

for (const how of ['mouse', 'keyboard'] as const) {
  test(`over an open dialog: the cover can be used by ${how}, and the same account gets the form back`, async ({ page, authMock }) => {
    await openApp(page, '/')
    await enterAdmin(page)
    await navigateInApp(page, '/admin/staff', 'Staff')
    await page.getByRole('button', { name: 'Appoint moderator' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Account email').fill('half.typed@example.org')

    authMock.meUnreachable = true
    await page.evaluate(() => {
      new BroadcastChannel('b17-auth').postMessage({ type: 'b17:auth-changed' })
    })
    // A second channel object of the same page is heard like another tab.
    const cover = page.getByRole('alertdialog')
    await expect(cover).toContainText("We couldn't check who is signed in")
    await expect(page.getByText('half.typed@example.org')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0) // the form is out of reach, not gone

    // Typing and Escape reach nothing beneath.
    await page.keyboard.type('zzz')
    await page.keyboard.press('Escape')

    authMock.meUnreachable = false
    const again = cover.getByRole('button', { name: 'Try again' })
    if (how === 'mouse') await again.click({ timeout: 5_000 })
    else {
      await page.keyboard.press('Tab')
      await expect(again).toBeFocused()
      await page.keyboard.press('Enter')
    }

    await expect(cover).toHaveCount(0)
    await expect(form).toBeVisible()
    await expect(form.getByLabel('Account email')).toHaveValue('half.typed@example.org')
    await form.getByRole('button', { name: 'Back', exact: true }).click() // and it still works
    await expect(form).toHaveCount(0)
  })
}

import type { Page } from '@playwright/test'
import { expect, mockFor, test } from './helpers/test'
import { emailFor, expectPage, navigateInApp, openApp, pushInApp, signIn } from './helpers/app'
import type { AuthMock } from './helpers/authMock'

/** The grocery STAFF workspace (GROCERY-3B), in a real browser against the mock backend. */

const CUSTOMER = 'Ayesha Khan'
const SECRET_CONSENT = 'INTERNAL-NOTE brown rice accepted'
const SECRET_REASON = 'INTERNAL-REASON gate was locked'
const PRIVATE = [CUSTOMER, '0300 1234567', '+923001234567', 'House 17, Street 4', 'Blue gate']

function seedOrder(mock: AuthMock) {
  const owner = emailFor(CUSTOMER)
  if (!mock.accounts.has(owner)) mock.addAccount({ email: owner, displayName: CUSTOMER })
  return mock.grocery.seed(owner)
}

const staffPosts = (mock: AuthMock) =>
  mock.calls.filter((call) => call.method === 'POST' && call.path.startsWith('/admin/grocery/'))

/** Signs in on the staff sign-in page, reached by being sent there from the workspace. */
async function staffSignIn(page: Page, name: string, kind: 'groceryModerator' | 'admin' = 'groceryModerator') {
  await openApp(page, '/admin/grocery', 'Admin Login')
  await signIn(page, name, kind)
  await expectPage(page, 'Grocery orders')
}

const actions = (page: Page) => page.getByRole('region', { name: 'Actions' })
const dialog = (page: Page) => page.getByRole('dialog')

async function act(page: Page, action: string, send: string, fill?: () => Promise<void>) {
  await actions(page).getByRole('button', { name: action, exact: true }).click()
  await expect(dialog(page)).toBeVisible()
  await fill?.()
  await dialog(page).getByRole('button', { name: send, exact: true }).click()
  await expect(dialog(page)).toBeHidden()
}

async function agree(page: Page, total: string) {
  await dialog(page).getByLabel('Items (Rs)').fill(total)
  await dialog(page).getByLabel('Total the customer agreed to (Rs)').fill(total)
  await dialog(page).getByRole('radio', { name: 'Phone call' }).check()
  await dialog(page).getByRole('radio', { name: 'Yes, they agreed to a substitute' }).check()
  await dialog(page).getByLabel('Which substitutes they agreed to').fill(SECRET_CONSENT)
  await dialog(page).getByRole('checkbox').check()
}

test('the whole staff journey, and what the customer then sees', async ({ page, authMock }) => {
  const order = seedOrder(authMock)
  const messages: string[] = []
  page.on('console', (message) => messages.push(message.text()))
  const urls: string[] = []
  page.on('request', (request) => urls.push(request.url()))

  await staffSignIn(page, 'Sana Staff')
  const row = page.getByRole('list', { name: 'Orders' }).getByRole('link')
  await expect(row).toHaveCount(1)
  for (const value of PRIVATE) await expect(page.getByRole('main')).not.toContainText(value)

  await row.click()
  await expectPage(page, `Order ${order.reference}`)
  await expect(page.getByRole('link', { name: 'Call customer' })).toHaveAttribute('href', 'tel:+923001234567')
  await actions(page).getByRole('button', { name: 'Claim order' }).click()
  await expect(actions(page)).toContainText('Assigned to you')

  await act(page, 'Record agreement', 'Confirm order', () => agree(page, '2100.50'))
  await expect(page.getByRole('region', { name: 'Recorded agreements' })).toContainText('Rs 2,100.50')
  await act(page, 'Start preparing', 'Start preparing')
  await act(page, 'Send out for delivery', 'Out for delivery')
  await act(page, 'Record failed delivery', 'Record failed delivery', () => dialog(page).getByLabel('Reason').fill(SECRET_REASON))
  await expect(page.getByRole('region', { name: 'Delivery attempts' })).toContainText('Attempt 1: Failed')
  await act(page, 'Send out for delivery', 'Out for delivery')
  await act(page, 'Record delivery and cash', 'Record delivered and paid', async () => {
    await dialog(page).getByLabel('Cash you collected (Rs)').fill('2,100.50')
    await dialog(page).getByRole('checkbox').check()
  })
  await expect(page.getByRole('region', { name: 'Amount due and cash' })).toContainText('Cash collected: Rs 2,100.50')

  expect(staffPosts(authMock).map((call) => call.path.split('/').pop())).toEqual([
    'claim', 'confirm', 'start-preparing', 'dispatch', 'delivery-failed', 'dispatch', 'complete',
  ])
  expect(staffPosts(authMock).at(-1)!.body).toEqual({ revision: 6, amountCollectedPaisa: 210_050 })
  expect(staffPosts(authMock).every((call) => call.csrf)).toBe(true)

  // Nothing private reaches an address, the console or browser storage.
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))
  const databases = await page.evaluate(async () => (await indexedDB.databases()).length)
  expect(databases).toBe(0)
  for (const value of [...PRIVATE, SECRET_CONSENT, SECRET_REASON, '923001234567']) {
    expect(stored).not.toContain(value)
    expect(messages.join('\n')).not.toContain(value)
    expect(urls.map(decodeURIComponent).join('\n')).not.toContain(value)
  }

  // The customer sees the result and none of the staff's records.
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('button', { name: 'Log out' }).click()
  await expectPage(page, 'Admin Login')
  for (const value of PRIVATE) await expect(page.locator('body')).not.toContainText(value)
  await navigateInApp(page, '/login', 'Log In')
  await signIn(page, CUSTOMER, 'resident')
  await expectPage(page)
  await navigateInApp(page, `/profile/grocery/${order.id}`, `Order ${order.reference}`)
  await expect(page.getByText('Paid in cash: Rs 2,100.50')).toBeVisible()
  for (const value of [SECRET_CONSENT, SECRET_REASON, 'Sana Staff']) await expect(page.locator('body')).not.toContainText(value)
})

test('a deep link to an order survives signing in', async ({ page, authMock }) => {
  const order = seedOrder(authMock)
  await openApp(page, `/admin/grocery/${order.id}`, 'Admin Login')
  await expect(page.locator('body')).not.toContainText(order.reference)
  expect(authMock.calls.filter((call) => call.path.startsWith('/admin/'))).toEqual([])
  await signIn(page, 'Sana Staff', 'groceryModerator')
  await expectPage(page, `Order ${order.reference}`)
  await expect(page).toHaveURL(`/admin/grocery/${order.id}`)
})

test('the admin areas stay Super Admin only, and the grocery area stays grocery staff only', async ({ page, authMock }) => {
  seedOrder(authMock)
  await staffSignIn(page, 'Sana Staff')
  const nav = page.getByRole('navigation', { name: 'Admin' })
  await expect(nav.getByRole('link')).toHaveCount(1)
  for (const path of ['/admin', '/admin/moderation', '/admin/categories', '/admin/content']) {
    await pushInApp(page, path)
    await expectPage(page, 'Admin access only')
  }
  expect(authMock.calls.filter((call) => /^\/admin\/(listings|categories)/.test(call.path))).toEqual([])

  // Her way in from the account page.
  await navigateInApp(page, '/profile')
  await page.getByRole('link', { name: 'Grocery staff' }).click()
  await expectPage(page, 'Grocery orders')
  await nav.getByRole('button', { name: 'Log out' }).click()
  await expectPage(page, 'Admin Login')

  // A moderator of another scope.
  authMock.addAccount({ email: emailFor('Farah Food'), displayName: 'Farah Food', roles: ['moderator'], staffScopes: ['food'] })
  await signIn(page, 'Farah Food')
  await expect(page.getByRole('alert')).toContainText("isn't an administrator account")
  const before = authMock.calls.filter((call) => call.path.startsWith('/admin/grocery')).length
  await pushInApp(page, '/admin/grocery')
  await expectPage(page, 'Grocery staff access only')
  expect(authMock.calls.filter((call) => call.path.startsWith('/admin/grocery'))).toHaveLength(before)
})

test('a Super Admin reaches grocery from the admin navigation and never sees their own order', async ({ page, authMock }) => {
  seedOrder(authMock)
  authMock.addAccount({ email: emailFor('Omar Admin'), displayName: 'Omar Admin', roles: ['admin'] })
  const own = authMock.grocery.seed(emailFor('Omar Admin'))
  await openApp(page, '/admin/login', 'Admin Login')
  await signIn(page, 'Omar Admin', 'admin')
  await expectPage(page, 'Admin Dashboard')
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Grocery' }).click()
  await expectPage(page, 'Grocery orders')
  await expect(page.getByRole('list', { name: 'Orders' }).getByRole('link')).toHaveCount(1)
  await expect(page.getByRole('main')).not.toContainText(own.reference)

  await navigateInApp(page, `/admin/grocery/${own.id}`, 'This is your own order')
  await page.getByRole('button', { name: 'View it as a customer' }).click()
  await expectPage(page, `Order ${own.reference}`)
  await expect(page).toHaveURL(`/profile/grocery/${own.id}`)
})

test('an unclear answer is never sent again, and the reloaded order decides', async ({ page, authMock }) => {
  const order = seedOrder(authMock)
  authMock.grocery.staffConfirm(order.id)
  await staffSignIn(page, 'Sana Staff')
  authMock.groceryStaff.assign(order.id, { userId: authMock.idOf(emailFor('Sana Staff')), displayName: 'Sana Staff' })
  await navigateInApp(page, `/admin/grocery/${order.id}`, `Order ${order.reference}`)

  authMock.groceryStaffFaults.push('lost-after')
  await actions(page).getByRole('button', { name: 'Start preparing' }).click()
  await dialog(page).getByRole('button', { name: 'Start preparing' }).click()
  const notice = page.getByText('Check whether the start of preparation was saved')
  await expect(notice).toBeVisible()
  await expect(notice).toBeInViewport()
  await expect(page.getByRole('region', { name: 'Status history' })).toContainText('Confirmed → Preparing')
  expect(staffPosts(authMock)).toHaveLength(1)
})

test('two clicks send one change, and nothing is shown before the server answers', async ({ page, authMock }) => {
  const order = seedOrder(authMock)
  await staffSignIn(page, 'Sana Staff')
  await navigateInApp(page, `/admin/grocery/${order.id}`, `Order ${order.reference}`)
  const release = authMock.holdGroceryStaffWrite()
  await actions(page).getByRole('button', { name: 'Claim order' }).dblclick()
  await expect(actions(page).getByRole('button', { name: 'Claiming…' })).toBeDisabled()
  await expect(actions(page)).toContainText('Unassigned')
  release()
  await expect(actions(page)).toContainText('Assigned to you')
  expect(staffPosts(authMock)).toHaveLength(1)
})

test('after another tab switches accounts, a pressed button never acts as the other person', async ({ page, authMock }) => {
  const order = seedOrder(authMock)
  await staffSignIn(page, 'Sana Staff')
  await navigateInApp(page, `/admin/grocery/${order.id}`, `Order ${order.reference}`)

  const other = authMock.addAccount({ email: emailFor('Bilal Staff'), displayName: 'Bilal Staff', roles: ['moderator'], staffScopes: ['grocery'] })
  authMock.session = { email: other.email, csrf: 'csrf-of-the-other-tab' }
  await actions(page).getByRole('button', { name: 'Claim order' }).click()

  // The screen is rebuilt for the account now signed in; the claim was refused and not repeated.
  await expect(actions(page).getByRole('button', { name: 'Claim order' })).toBeEnabled()
  await expect(actions(page)).toContainText('Unassigned')
  expect(staffPosts(authMock)).toHaveLength(1)
  expect(authMock.groceryStaff.record(authMock.grocery.orders[0]).assignee).toBeUndefined()
})

test('an expired staff session, and removed access, close the order', async ({ page, authMock }) => {
  const order = seedOrder(authMock)
  await staffSignIn(page, 'Sana Staff')
  await navigateInApp(page, `/admin/grocery/${order.id}`, `Order ${order.reference}`)
  await expect(page.getByRole('main')).toContainText('House 17, Street 4')

  authMock.groceryStaffSessionStale = true
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expectPage(page, 'Admin Login')
  for (const value of PRIVATE) await expect(page.locator('body')).not.toContainText(value)

  authMock.groceryStaffSessionStale = false
  await signIn(page, 'Sana Staff', 'groceryModerator')
  await expectPage(page, `Order ${order.reference}`)
  mockFor(page).accounts.get(emailFor('Sana Staff'))!.staffScopes = []
  await actions(page).getByRole('button', { name: 'Claim order' }).click()
  await expectPage(page, 'Grocery staff access only')
  for (const value of PRIVATE) await expect(page.locator('body')).not.toContainText(value)
})

import type { Page } from '@playwright/test'
import { expect, test } from './helpers/test'
import { emailFor, expectPage, navigateInApp, openApp, pushInApp, signIn } from './helpers/app'
import type { AuthMock } from './helpers/authMock'

/** Super Admin grocery settings and staff management (GROCERY-3C), in a real browser against the mock. */

const ADMIN = 'Omar Admin'
const PRIVATE = ['sana.grocer@example.org', 'rafi.resident@example.org']

function people(mock: AuthMock) {
  mock.addAccount({ email: emailFor(ADMIN), displayName: ADMIN, roles: ['admin'] })
  mock.addAccount({ email: emailFor('Sana Grocer'), displayName: 'Sana Grocer', roles: ['moderator'], staffScopes: ['grocery'] })
  mock.addAccount({ email: emailFor('Rafi Resident'), displayName: 'Rafi Resident' })
}

async function signInAdmin(page: Page, path: string, title: string) {
  await openApp(page, path, 'Admin Login')
  await signIn(page, ADMIN, 'admin')
  await expectPage(page, title)
}

const dialog = (page: Page) => page.getByRole('dialog')
const writes = (mock: AuthMock) =>
  mock.calls.filter((call) => call.method !== 'GET' && /^\/admin\/(grocery\/settings|staff)/.test(call.path))

async function openMember(page: Page, name: string) {
  await page.getByRole('list', { name: 'Staff' }).getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
}

const memberAction = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Change this moderator' }).getByRole('button', { name })

async function nothingPrivateKept(page: Page, messages: string[], urls: string[]) {
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0)
  for (const value of PRIVATE) {
    expect(stored).not.toContain(value)
    expect(messages.join('\n')).not.toContain(value)
    expect(urls.map(decodeURIComponent).join('\n')).not.toContain(value)
  }
}

test('settings: from safe defaults to ordering on, and the customer page follows the saved version', async ({ page, authMock }) => {
  people(authMock)
  authMock.grocery.enabled = false
  authMock.grocery.blocks = []
  await signInAdmin(page, '/admin/grocery', 'Grocery orders')
  await page.getByRole('link', { name: 'Grocery settings' }).click()
  await expectPage(page, 'Grocery settings')
  await expect(page.getByRole('region', { name: 'Saved now' })).toContainText('Ordering is switched off')
  await expect(page.getByRole('region', { name: 'Delivery coverage' })).toContainText('No block is listed')
  expect(writes(authMock)).toEqual([])

  await page.getByLabel('Accept new grocery orders').check()
  await page.getByLabel('Add a block').fill('Test Block A')
  await page.getByLabel('Add a block').press('Enter')
  await page.getByLabel(/^Largest order total/).fill('15,000.50')
  await page.getByRole('region', { name: 'Unsaved changes' }).getByRole('button', { name: 'Review changes' }).click()
  await dialog(page).getByRole('button', { name: 'Save settings' }).click()
  await expect(dialog(page)).toContainText('Confirm that you mean to switch ordering.')
  expect(writes(authMock)).toEqual([])
  await dialog(page).getByRole('checkbox', { name: 'Yes, switch grocery ordering ON.' }).check()
  await dialog(page).getByRole('button', { name: 'Save settings' }).dblclick()
  await expect(dialog(page)).toBeHidden()
  await expect(page.getByRole('region', { name: 'Saved now' })).toContainText('Ordering is switched on')
  await expect(page.getByRole('region', { name: 'Saved now' })).toContainText('Version 2')
  expect(writes(authMock)).toHaveLength(1)
  expect(writes(authMock)[0].body).toEqual({
    revision: 1,
    enabled: true,
    serviceableBlocks: ['Test Block A'],
    maxOrderValuePaisa: 1_500_050,
  })
  expect(writes(authMock)[0].csrf).toBeTruthy()

  await navigateInApp(page, '/grocery', 'Grocery')
  await expect(page.getByRole('main')).toContainText('Test Block A')
})

test('settings: another admin saving first is never overwritten', async ({ page, authMock }) => {
  people(authMock)
  await signInAdmin(page, '/admin/grocery/settings', 'Grocery settings')
  await page.getByLabel(/^Orders accepted per day/).fill('15')
  await page.getByRole('button', { name: 'Review changes' }).click()
  authMock.admin.saveElsewhere({ opensAt: '09:00' })
  await dialog(page).getByRole('button', { name: 'Save settings' }).click()
  const conflict = page.getByRole('region', { name: /Version 2 was saved while you were editing version 1/ })
  await expect(conflict).toBeVisible()
  expect(authMock.admin.settings).toMatchObject({ revision: 2, dailyCapacity: 10 })
  await conflict.getByRole('button', { name: 'Keep my edits on version 2' }).click()
  await page.getByRole('button', { name: 'Review changes' }).click()
  await dialog(page).getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('region', { name: 'Saved now' })).toContainText('Version 3')
  expect(writes(authMock).at(-1)!.body).toEqual({ revision: 2, dailyCapacity: 15 })
  expect(authMock.admin.settings.opensAt).toBe('09:00')
})

test('settings: unsaved edits are held on leaving and on reload', async ({ page, authMock }) => {
  people(authMock)
  await signInAdmin(page, '/admin/grocery/settings', 'Grocery settings')
  await page.getByLabel(/^Orders accepted per day/).fill('15')
  await page.getByRole('link', { name: 'Grocery queue' }).click()
  await expect(dialog(page)).toContainText('Leave without saving?')
  await dialog(page).getByRole('button', { name: 'Stay here' }).click()
  await expect(page).toHaveURL('/admin/grocery/settings')
  await expect(page.getByLabel(/^Orders accepted per day/)).toHaveValue('15')

  const asked: string[] = []
  page.once('dialog', (prompt) => {
    asked.push(prompt.type())
    void prompt.dismiss()
  })
  await page.reload({ timeout: 3_000 }).catch(() => {})
  expect(asked).toEqual(['beforeunload'])
  await expect(page.getByLabel(/^Orders accepted per day/)).toHaveValue('15')

  await page.getByRole('link', { name: 'Grocery queue' }).click()
  await dialog(page).getByRole('button', { name: 'Discard and leave' }).click()
  await expectPage(page, 'Grocery orders')
  expect(writes(authMock)).toEqual([])
})

test('staff: appoint a grocery moderator who can then work orders; pausing ends that', async ({ page, authMock }) => {
  people(authMock)
  const messages: string[] = []
  page.on('console', (message) => messages.push(message.text()))
  const urls: string[] = []
  page.on('request', (request) => urls.push(request.url()))
  await signInAdmin(page, '/admin/staff', 'Staff')
  const nav = page.getByRole('navigation', { name: 'Admin' })
  await expect(nav.getByRole('link', { name: 'Staff' })).toHaveAttribute('aria-current', 'page')

  await page.getByRole('button', { name: 'Appoint moderator' }).click()
  await dialog(page).getByLabel('Account email').fill(emailFor('Rafi Resident'))
  await dialog(page).getByRole('checkbox', { name: 'Grocery orders' }).check()
  await dialog(page).getByRole('button', { name: 'Review' }).click()
  await expect(dialog(page)).toContainText('Moderator for: Grocery orders')
  await dialog(page).getByRole('checkbox', { name: /checked that this is the right/ }).check()
  await dialog(page).getByRole('button', { name: 'Appoint moderator' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Rafi Resident' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Changes to this account' })).toContainText('Moderator appointed')
  await nothingPrivateKept(page, messages, urls)

  // The appointed person: the grocery workspace, and nothing of the Super Admin's.
  await nav.getByRole('button', { name: 'Log out' }).click()
  await expectPage(page, 'Admin Login')
  await signIn(page, 'Rafi Resident')
  await expectPage(page, 'Grocery orders')
  await expect(page.getByRole('link', { name: 'Grocery settings' })).toHaveCount(0)
  const before = authMock.calls.filter((call) => /^\/admin\/(staff|audit|grocery\/settings)/.test(call.path)).length
  for (const path of ['/admin/staff', '/admin/staff/history', '/admin/grocery/settings']) {
    await pushInApp(page, path)
    await expectPage(page, 'Admin access only')
    for (const value of PRIVATE) await expect(page.locator('body')).not.toContainText(value)
  }
  expect(authMock.calls.filter((call) => /^\/admin\/(staff|audit|grocery\/settings)/.test(call.path))).toHaveLength(before)

  // Paused: no access at all.
  await nav.getByRole('button', { name: 'Log out' }).click()
  await expectPage(page, 'Admin Login')
  await signIn(page, ADMIN, 'admin')
  await expectPage(page)
  await navigateInApp(page, '/admin/staff', 'Staff')
  await openMember(page, 'Rafi Resident')
  await memberAction(page, 'Pause').click()
  await dialog(page).getByRole('button', { name: 'Pause moderator' }).click()
  await expect(page.getByText('Paused: no staff access.')).toBeVisible()
  await nav.getByRole('button', { name: 'Log out' }).click()
  await expectPage(page, 'Admin Login')
  await signIn(page, 'Rafi Resident')
  await expect(page.getByRole('alert')).toContainText("isn't an administrator account")
  await pushInApp(page, '/admin/grocery')
  await expectPage(page, 'Grocery staff access only')
})

test('staff: a sign-in that is too old leads to signing in again, and nothing is sent by itself', async ({ page, authMock }) => {
  people(authMock)
  await signInAdmin(page, '/admin/staff', 'Staff')
  await openMember(page, 'Sana Grocer')
  authMock.admin.recentSignIn = false
  await memberAction(page, 'Pause').click()
  await dialog(page).getByRole('button', { name: 'Pause moderator' }).click()
  await expect(dialog(page)).toContainText('Sign in again to manage staff')
  await dialog(page).getByRole('button', { name: 'Sign out and sign in again' }).click()
  await expectPage(page, 'Admin Login')
  await expect(page.getByText(/You'll come back to Staff after signing in/)).toBeVisible()
  await signIn(page, ADMIN, 'admin')
  await expectPage(page, 'Staff')
  await expect(page).toHaveURL('/admin/staff')
  await expect(page.getByRole('list', { name: 'Staff' })).toBeVisible()
  await expect(dialog(page)).toHaveCount(0)
  expect(writes(authMock)).toHaveLength(1) // the refused one only
  expect(authMock.accounts.get(emailFor('Sana Grocer'))!.staffScopes).toEqual(['grocery'])

  // Confirmed again by hand, it goes through.
  await openMember(page, 'Sana Grocer')
  await memberAction(page, 'Pause').click()
  await dialog(page).getByRole('button', { name: 'Pause moderator' }).click()
  await expect(page.getByText('Paused: no staff access.')).toBeVisible()
  expect(writes(authMock)).toHaveLength(2)
})

test('after another tab switches admins, a pressed button never acts as the other one', async ({ page, authMock }) => {
  people(authMock)
  const other = authMock.addAccount({ email: emailFor('Zara Admin'), displayName: 'Zara Admin', roles: ['admin'] })
  await signInAdmin(page, '/admin/staff', 'Staff')
  await openMember(page, 'Sana Grocer')
  await memberAction(page, 'Pause').click()
  authMock.session = { email: other.email, csrf: 'csrf-of-the-other-tab' }
  await dialog(page).getByRole('button', { name: 'Pause moderator' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Staff' }).getByRole('button', { name: /Zara Admin.*You/ })).toBeVisible()
  // The read made before a staff change is confirmed like any private read, so it finds the other
  // account and the change is never sent at all.
  expect(writes(authMock)).toHaveLength(0)
  expect(authMock.accounts.get(emailFor('Sana Grocer'))!.staffScopes).toEqual(['grocery'])
})

test('an expired admin session and a removed role close the screens', async ({ page, authMock }) => {
  people(authMock)
  await signInAdmin(page, '/admin/staff', 'Staff')
  authMock.adminSessionStale = true
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expectPage(page, 'Admin Login')
  for (const value of PRIVATE) await expect(page.locator('body')).not.toContainText(value)
  authMock.adminSessionStale = false
  await signIn(page, ADMIN, 'admin')
  await expectPage(page, 'Staff')
  // The list shows only once its read has been confirmed: no confirmation is still on its way to notice
  // the removal below before Refresh is pressed.
  await expect(page.getByRole('list', { name: 'Staff' })).toBeVisible()
  authMock.accounts.get(emailFor(ADMIN))!.roles = []
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expectPage(page, 'Admin access only')
  for (const value of PRIVATE) await expect(page.locator('body')).not.toContainText(value)
})

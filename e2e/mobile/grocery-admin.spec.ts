import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../helpers/test'
import { emailFor, expectPage, openApp, signIn } from '../helpers/app'
import type { AuthMock } from '../helpers/authMock'

/** Settings and staff management on a phone, and by keyboard (GROCERY-3C). */

const ADMIN = 'Omar Admin'
const LONG = 'A Moderator With A Very Long Display Name Indeed'

/** The page title must get real width: buttons beside it once squeezed it to nothing. */
async function expectReadableTitle(page: Page) {
  const box = (await page.getByRole('heading', { level: 1 }).boundingBox())!
  expect(box.width).toBeGreaterThan(80)
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

async function expectTouchSized(...targets: Locator[]) {
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded()
    const box = (await target.boundingBox())!
    expect(box.height, String(target)).toBeGreaterThanOrEqual(44)
  }
}

function people(mock: AuthMock) {
  mock.addAccount({ email: emailFor(ADMIN), displayName: ADMIN, roles: ['admin'] })
  mock.addAccount({
    email: 'a.very.long.unbroken.email.address.that.must.wrap.somewhere@example.org',
    displayName: LONG,
    roles: ['moderator'],
    staffScopes: ['grocery', 'services', 'directory', 'food', 'education', 'property'],
  })
  mock.addAccount({ email: emailFor('Rafi Resident'), displayName: 'Rafi Resident' })
}

const dialog = (page: Page) => page.getByRole('dialog')

async function expectDialogFits(page: Page, send: string) {
  const box = (await dialog(page).boundingBox())!
  const view = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(view.width)
  expect(box.height).toBeLessThanOrEqual(view.height)
  expect(await dialog(page).evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)
  const button = dialog(page).getByRole('button', { name: send, exact: true })
  await button.scrollIntoViewIfNeeded()
  await expect(button).toBeInViewport()
  await expectTouchSized(button, dialog(page).getByRole('button', { name: 'Back' }))
}

for (const width of [375, 320]) {
  test(`settings and staff management fit a ${width}px phone`, async ({ page, authMock }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 740 })
    people(authMock)
    await openApp(page, '/admin/grocery/settings', 'Admin Login')
    await signIn(page, ADMIN, 'admin')
    await expectPage(page, 'Grocery settings')
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    await expectReadableTitle(page)
    // The whole staff navigation is on screen, each control a full target.
    const nav = page.getByRole('navigation', { name: 'Admin' })
    for (const control of [...(await nav.getByRole('link').all()), nav.getByRole('button', { name: 'Log out' })]) {
      const box = (await control.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
    await expectTouchSized(
      page.getByRole('button', { name: 'Refresh' }),
      page.locator('label', { hasText: 'Accept new grocery orders' }),
      page.locator('label', { hasText: 'Wednesday' }),
      page.getByLabel('Add a block'),
      page.getByRole('button', { name: 'Add', exact: true }),
      page.getByLabel('Opens at'),
      page.getByLabel(/^Orders accepted per day/),
      page.getByLabel(/^Largest order total/)
    )
    await page.getByLabel('Add a block').fill('A Very Long Test Block Name Of Forty Ch')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expectTouchSized(page.getByRole('button', { name: /^Remove block/ }))
    await page.locator('label', { hasText: 'Accept new grocery orders' }).click()
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    // The save bar stays reachable and covers neither edge.
    const bar = page.getByRole('region', { name: 'Unsaved changes' })
    await expect(bar).toBeInViewport()
    await bar.getByRole('button', { name: 'Review changes' }).click()
    await expectDialogFits(page, 'Save settings')
    await expectTouchSized(dialog(page).locator('label', { hasText: 'Yes, switch grocery ordering ON.' }))
    await dialog(page).getByRole('button', { name: 'Back' }).click()
    await bar.getByRole('button', { name: 'Discard' }).click()

    // A problem is brought into view.
    await page.getByLabel(/^Orders accepted per day/).fill('999')
    await bar.getByRole('button', { name: 'Review changes' }).click()
    await expect(page.getByLabel(/^Orders accepted per day/)).toBeFocused()
    await expect(page.getByLabel(/^Orders accepted per day/)).toBeInViewport()
    await bar.getByRole('button', { name: 'Discard' }).click()

    await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Grocery', exact: true }).click()
    await expectPage(page, 'Grocery orders')
    await expectReadableTitle(page)
    await expectTouchSized(page.getByRole('link', { name: 'Grocery settings' }))
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Staff' }).click()
    await expectPage(page, 'Staff')
    await expect(page.getByRole('list', { name: 'Staff' })).toBeVisible()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    await expectReadableTitle(page)
    await expectTouchSized(
      page.getByRole('button', { name: 'Appoint moderator' }),
      page.getByRole('link', { name: 'Staff history' }),
      page.getByRole('button', { name: 'Sign in again' })
    )
    await page.getByRole('list', { name: 'Staff' }).getByRole('button', { name: new RegExp(`^${LONG}`) }).click()
    await expect(page.getByRole('heading', { level: 2, name: LONG })).toBeVisible()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    const group = page.getByRole('group', { name: 'Change this moderator' })
    await expectTouchSized(group.getByRole('button', { name: 'Change scopes' }), group.getByRole('button', { name: 'Remove moderator' }))
    await group.getByRole('button', { name: 'Change scopes' }).click()
    await expectDialogFits(page, 'Save scopes')
    await expectTouchSized(dialog(page).locator('label', { hasText: 'Grocery orders' }))
    await dialog(page).getByRole('button', { name: 'Back' }).click()

    // The refusal that asks for a new sign-in comes into view, with its button.
    authMock.admin.recentSignIn = false
    await group.getByRole('button', { name: 'Pause' }).click()
    await dialog(page).getByRole('button', { name: 'Pause moderator' }).click()
    await expect(dialog(page).getByRole('button', { name: 'Sign out and sign in again' })).toBeInViewport()
    await dialog(page).getByRole('button', { name: 'Back' }).click()

    await page.getByRole('button', { name: 'All staff' }).click()
    await page.getByRole('link', { name: 'Staff history' }).click()
    await expectPage(page, 'Staff history')
    await expectReadableTitle(page)
    await expectTouchSized(page.getByLabel('Kind of action'))
    expect(await overflow(page)).toBeLessThanOrEqual(0)
  })
}

test('a moderator can be appointed and the settings changed by keyboard alone', async ({ page, authMock }) => {
  await page.setViewportSize({ width: 375, height: 740 })
  people(authMock)
  await openApp(page, '/admin/staff', 'Admin Login')
  await signIn(page, ADMIN, 'admin')
  await expectPage(page, 'Staff')
  await expect(page.getByRole('list', { name: 'Staff' })).toBeVisible()

  const open = page.getByRole('button', { name: 'Appoint moderator' })
  await open.focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab')
    expect(await dialog(page).evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await expect(open).toBeFocused()

  await page.keyboard.press('Enter')
  await dialog(page).getByLabel('Account email').focus()
  await page.keyboard.type(emailFor('Rafi Resident'))
  await dialog(page).getByRole('checkbox', { name: 'Food' }).focus()
  await page.keyboard.press('Space')
  await dialog(page).getByLabel('Account email').focus()
  await page.keyboard.press('Enter')
  await dialog(page).getByRole('checkbox', { name: /checked that/ }).focus()
  await page.keyboard.press('Space')
  await dialog(page).getByRole('button', { name: 'Appoint moderator' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 2, name: 'Rafi Resident' })).toBeFocused()

  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Grocery' }).focus()
  await page.keyboard.press('Enter')
  await expectPage(page, 'Grocery orders')
  await page.getByRole('link', { name: 'Grocery settings' }).focus()
  await page.keyboard.press('Enter')
  await expectPage(page, 'Grocery settings')
  await page.getByLabel('Add a block').focus()
  await page.keyboard.type('Test Block A')
  await page.keyboard.press('Enter')
  const review = page.getByRole('button', { name: 'Review changes' })
  await review.focus()
  await page.keyboard.press('Enter')
  await dialog(page).getByRole('button', { name: 'Save settings' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeHidden()
  // The button that was used is gone: focus moves to the saved record, not nowhere.
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('settings-saved-heading')
  expect(authMock.admin.settings.serviceableBlocks).toEqual(['Test Block A'])
})

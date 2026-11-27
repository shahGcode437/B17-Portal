import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../helpers/test'
import { emailFor, expectPage, navigateInApp, openApp, signIn } from '../helpers/app'
import type { AuthMock } from '../helpers/authMock'

/** The grocery staff workspace on a phone, and by keyboard (GROCERY-3B). */

test.use({ viewport: { width: 375, height: 740 } })

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

async function expectTouchSized(...targets: Locator[]) {
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded()
    const box = (await target.boundingBox())!
    expect(box.height, String(target)).toBeGreaterThanOrEqual(44)
  }
}

function seed(mock: AuthMock) {
  const owner = emailFor('Ayesha Khan')
  mock.addAccount({ email: owner, displayName: 'Ayesha Khan' })
  return mock.grocery.seed(owner, {
    items: [
      { name: 'A very long item name that has to wrap onto more than one line on a phone', unit: 'kg', quantity: '2.5', substitution: 'ask', preferredBrand: 'AnUnbrokenBrandNameThatIsVeryLongIndeed', note: 'Ripe ones, please' },
    ],
    delivery: {
      contactName: 'Ayesha Khan',
      contactPhone: '+923001234567',
      block: 'Test Block A',
      addressLine: 'House 17, Street 4, next to the big park with the very long name',
    },
    instructions: 'Ring twice.',
  })
}

const dialog = (page: Page) => page.getByRole('dialog')
const actions = (page: Page) => page.getByRole('region', { name: 'Actions' })

/** A dialog must fit the phone, and its last button must be reachable by scrolling inside it. */
async function expectDialogFits(page: Page, send: string) {
  const box = (await dialog(page).boundingBox())!
  const view = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(view.width)
  expect(box.height).toBeLessThanOrEqual(view.height)
  const sideways = await dialog(page).evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(sideways).toBeLessThanOrEqual(0)
  const button = dialog(page).getByRole('button', { name: send, exact: true })
  await button.scrollIntoViewIfNeeded()
  await expect(button).toBeInViewport()
  await expectTouchSized(button, dialog(page).getByRole('button', { name: 'Back' }))
}

for (const width of [375, 320]) {
  test(`the queue, an order and its forms fit a ${width}px phone`, async ({ page, authMock }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 740 })
    const order = seed(authMock)
    await openApp(page, '/admin/grocery', 'Admin Login')
    await signIn(page, 'Sana Staff', 'groceryModerator')
    await expectPage(page, 'Grocery orders')
    await expect(page.getByRole('list', { name: 'Orders' }).getByRole('link')).toHaveCount(1)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    await expectTouchSized(
      page.getByRole('button', { name: 'Refresh' }),
      page.getByRole('radio', { name: /^Submitted/ }),
      page.getByLabel('Order reference'),
      page.getByRole('button', { name: 'Search' }),
      page.getByLabel('Assigned to'),
      page.getByLabel('Sent on'),
      page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Grocery' }),
      page.getByRole('button', { name: 'Next' })
    )

    await page.getByRole('list', { name: 'Orders' }).getByRole('link').click()
    await expectPage(page, `Order ${order.reference}`)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    // On a phone the actions come first, then the customer.
    const first = (await actions(page).boundingBox())!
    const customer = (await page.getByRole('region', { name: 'Customer and delivery' }).boundingBox())!
    expect(first.y).toBeLessThan(customer.y)
    await expectTouchSized(
      actions(page).getByRole('button', { name: 'Claim order' }),
      actions(page).getByRole('button', { name: 'Record issue' }),
      page.getByRole('link', { name: 'Call customer' }),
      page.getByRole('link', { name: 'Grocery queue' })
    )

    await actions(page).getByRole('button', { name: 'Claim order' }).click()
    await actions(page).getByRole('button', { name: 'Record agreement' }).click()
    await expectDialogFits(page, 'Confirm order')
    await expect(dialog(page).getByLabel('Items (Rs)')).toHaveAttribute('inputmode', 'decimal')
    await expectTouchSized(
      dialog(page).getByLabel('Items (Rs)'),
      dialog(page).getByLabel('Total the customer agreed to (Rs)'),
      // the whole row is the target, not just its words
      dialog(page).locator('label', { hasText: 'Phone call' }),
      dialog(page).locator('label', { hasText: 'No substitute was agreed' }),
      dialog(page).locator('label', { has: page.getByRole('checkbox') })
    )
    // A problem is brought into view, not left above the fold.
    await dialog(page).getByRole('button', { name: 'Confirm order' }).click()
    await expect(dialog(page).getByLabel('Items (Rs)')).toBeFocused()
    await expect(dialog(page).getByLabel('Items (Rs)')).toBeInViewport()

    // A server refusal is brought into view too.
    await dialog(page).getByLabel('Items (Rs)').fill('30000')
    await dialog(page).getByLabel('Total the customer agreed to (Rs)').fill('30000')
    await dialog(page).getByText('Phone call').click()
    await dialog(page).getByText('No substitute was agreed').click()
    await dialog(page).getByRole('checkbox').check()
    await dialog(page).getByRole('button', { name: 'Confirm order' }).click()
    await expect(dialog(page).getByText(/above the largest order allowed/)).toBeInViewport()
    await dialog(page).getByRole('button', { name: 'Back' }).click()

    await actions(page).getByRole('button', { name: 'Record issue' }).click()
    await expectDialogFits(page, 'Record issue')
    await dialog(page).getByRole('button', { name: 'Back' }).click()
    await actions(page).getByRole('button', { name: 'Cancel order' }).click()
    await expectDialogFits(page, 'Cancel this order')
  })
}

test("a Super Admin's six staff navigation controls fit a 320px phone", async ({ page, authMock }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  seed(authMock)
  await openApp(page, '/admin/grocery', 'Admin Login')
  await signIn(page, 'Omar Admin', 'admin')
  await expectPage(page, 'Grocery orders')
  const nav = page.getByRole('navigation', { name: 'Admin' })
  for (const control of [...(await nav.getByRole('link').all()), nav.getByRole('button', { name: 'Log out' })]) {
    const box = (await control.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  }
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

test('an order can be worked by keyboard alone', async ({ page, authMock }) => {
  const order = seed(authMock)
  await openApp(page, '/admin/grocery', 'Admin Login')
  await signIn(page, 'Sana Staff', 'groceryModerator')
  await expectPage(page, 'Grocery orders')
  await navigateInApp(page, `/admin/grocery/${order.id}`, `Order ${order.reference}`)

  await actions(page).getByRole('button', { name: 'Claim order' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Actions' })).toBeFocused()

  const open = actions(page).getByRole('button', { name: 'Record agreement' })
  await open.focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  // Focus is kept inside the dialog.
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab')
    expect(await dialog(page).evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await expect(open).toBeFocused()

  await page.keyboard.press('Enter')
  await dialog(page).getByLabel('Items (Rs)').focus()
  await page.keyboard.type('100')
  await dialog(page).getByLabel('Total the customer agreed to (Rs)').focus()
  await page.keyboard.type('100')
  await dialog(page).getByRole('radio', { name: 'Phone call' }).focus()
  await page.keyboard.press('Space')
  await dialog(page).getByRole('radio', { name: 'No substitute was agreed' }).focus()
  await page.keyboard.press('Space')
  await dialog(page).getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  await dialog(page).getByRole('button', { name: 'Confirm order' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeHidden()
  // "Record agreement" is gone: focus goes to the actions, not nowhere.
  await expect(page.getByRole('heading', { name: 'Actions' })).toBeFocused()
  await expect(page.getByRole('region', { name: 'Recorded agreements' })).toContainText('Rs 100')
})

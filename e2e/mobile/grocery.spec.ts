import type { Locator, Page } from '@playwright/test'
import { expect, mockFor, test } from '../helpers/test'
import { emailFor, expectPage, navigateInApp, openApp, signIn } from '../helpers/app'

/** Grocery on a 375px phone (GROCERY-3A): no sideways scrolling, 44px targets, nothing hidden under the bottom bar. */

test.use({ viewport: { width: 375, height: 740 } })

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

async function expectTouchSized(...targets: Locator[]) {
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded()
    const box = (await target.boundingBox())!
    expect(box.height, String(target)).toBeGreaterThanOrEqual(44)
  }
}

test('the whole order journey fits a phone', async ({ page }) => {
  await openApp(page, '/grocery', 'Grocery')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await expectTouchSized(
    page.getByRole('link', { name: 'Start your grocery list' }),
    page.getByRole('main').getByRole('link', { name: 'My Grocery Orders' })
  )

  await page.getByRole('link', { name: 'Start your grocery list' }).click()
  await expectPage(page, 'Your grocery list')
  const form = page.getByRole('region', { name: 'Add an item' })
  await expectTouchSized(form.getByLabel('Item', { exact: true }), form.getByLabel('Quantity'), form.getByLabel('Unit'), form.getByRole('button', { name: 'Add to list' }))
  await expect(form.getByLabel('Quantity')).toHaveAttribute('inputmode', 'decimal')
  await form.getByLabel('Item', { exact: true }).fill('A very long item name that has to wrap onto more than one line on a phone')
  await form.getByLabel('Quantity').fill('2')
  await form.getByRole('button', { name: 'Add to list' }).click()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await expectTouchSized(page.getByRole('button', { name: /^Edit A very long/ }), page.getByRole('button', { name: /^Remove A very long/ }))

  // The sticky Continue bar sits above the bottom navigation, not under it.
  const next = page.getByRole('button', { name: 'Continue' })
  const nextBox = (await next.boundingBox())!
  const nav = (await page.locator('nav[aria-label="Primary"]:visible').last().boundingBox())!
  expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(nav.y)
  await next.click()

  await page.getByRole('button', { name: 'Log in or create an account' }).click()
  await signIn(page, 'Ayesha Khan', 'resident')
  await expectPage(page, 'Delivery details')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await expect(page.getByLabel('Phone number')).toHaveAttribute('type', 'tel')
  await expectTouchSized(page.getByLabel('Phone number'), page.getByLabel('Block'), page.getByRole('button', { name: 'Review order' }))
  await page.getByLabel('Phone number').fill('0300 1234567')
  await page.getByLabel('Block').selectOption('Test Block B')
  await page.getByLabel('House and street').fill('House 17, Street 4')
  await page.getByRole('button', { name: 'Review order' }).click()

  await expectPage(page, 'Check your order')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await expectTouchSized(page.getByRole('button', { name: 'Send my order' }))
  mockFor(page).grocerySubmitFaults.push('lost-after')
  await page.getByRole('button', { name: 'Send my order' }).click()
  // on a phone the explanation must come to the person, not stay above the screen
  const unconfirmed = page.getByRole('alert', { name: "We couldn't confirm your order" })
  await expect(unconfirmed).toBeInViewport({ ratio: 0.8 })
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await unconfirmed.getByRole('button', { name: 'Send the same order again' }).click()
  await expectPage(page, 'Order sent')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

test('history and order details fit a 320px screen too', async ({ page, authMock }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  const owner = emailFor('Ayesha Khan')
  authMock.addAccount({ email: owner, displayName: 'Ayesha Khan' })
  const order = authMock.grocery.seed(owner)
  authMock.grocery.staffConfirm(order.id)
  authMock.grocery.staffReconfirm(order.id, 1_500_000, 100_000, 400_000)
  authMock.grocery.staffReduce(order.id, 1_999_999)
  await openApp(page, '/login', 'Log In')
  await signIn(page, 'Ayesha Khan', 'resident')
  await expectPage(page)

  await navigateInApp(page, '/profile/grocery', 'My Grocery Orders')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await expectTouchSized(page.getByRole('button', { name: 'All', exact: true }), page.getByRole('button', { name: 'Refresh', exact: true }))

  await navigateInApp(page, `/profile/grocery/${order.id}`, `Order ${order.reference}`)
  await expect(page.getByText('Cash on delivery: Rs 19,999.99')).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await expectTouchSized(page.getByRole('button', { name: 'Refresh status' }))
})

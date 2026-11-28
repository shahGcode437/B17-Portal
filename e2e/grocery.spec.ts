import type { Page } from '@playwright/test'
import { expect, mockFor, test } from './helpers/test'
import { emailFor, expectPage, expectRobots, navigateInApp, openApp, signIn } from './helpers/app'

/**
 * The customer Grocery journey (GROCERY-3A) in the production build, against the mocked API
 * (`src/test/fixtures/groceryBackend.ts`, which follows the real contract). The mock has ordering
 * ENABLED with two test blocks; the real default is disabled with none.
 */

const submissions = (page: Page) => mockFor(page).calls.filter((call) => call.method === 'POST' && call.path === '/grocery/orders')

async function addItem(page: Page, name: string, quantity: string, unit = 'kg') {
  const form = page.getByRole('region', { name: 'Add an item' })
  await form.getByLabel('Item', { exact: true }).fill(name)
  await form.getByLabel('Quantity').fill(quantity)
  await form.getByLabel('Unit').selectOption(unit)
  await form.getByRole('button', { name: 'Add to list' }).click()
}

async function fillDelivery(page: Page) {
  await page.getByLabel('Phone number').fill('0300 1234567')
  await page.getByLabel('Block').selectOption('Test Block A')
  await page.getByLabel('House and street').fill('House 17, Street 4')
  await page.getByRole('button', { name: 'Review order' }).click()
  await expectPage(page, 'Check your order')
}

/** A signed-in resident with a list and delivery details, on the review step. */
async function reviewReady(page: Page, name = 'Ayesha Khan') {
  await openApp(page, '/login', 'Log In')
  await signIn(page, name, 'resident')
  await expectPage(page)
  await navigateInApp(page, '/grocery/new', 'Your grocery list')
  await addItem(page, 'Basmati rice', '5')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expectPage(page, 'Delivery details')
  await fillDelivery(page)
}

test('Grocery is reachable from the header, Home and the footer, and is not indexed', async ({ page }) => {
  await openApp(page, '/', 'B-17 Portal')
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Grocery' })).toBeVisible()
  await page.getByRole('link', { name: 'How Grocery works' }).click()
  await expectPage(page, 'Grocery')
  await expectRobots(page, 'noindex, follow')
  await openApp(page, '/', 'B-17 Portal')
  await page.getByRole('navigation', { name: 'Primary' }).first().getByRole('link', { name: 'Grocery' }).click()
  await expectPage(page, 'Grocery')
})

test('switched off: it says so, offers no ordering, and keeps existing orders reachable', async ({ page, authMock }) => {
  authMock.grocery.enabled = false
  authMock.grocery.blocks = []
  authMock.addAccount({ email: emailFor('Ayesha Khan'), displayName: 'Ayesha Khan' })
  const order = authMock.grocery.seed(emailFor('Ayesha Khan'))

  await openApp(page, '/grocery', 'Grocery')

  await expect(page.getByText('Grocery ordering is switched off')).toBeVisible()
  await expect(page.getByRole('link', { name: /Start your grocery list|Prepare a list/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'My Grocery Orders' }).click()
  await expectPage(page, 'Log In') // private, so sign in first...
  await signIn(page, 'Ayesha Khan', 'resident')
  await expectPage(page, 'My Grocery Orders') // ...and come back
  await expect(page.getByRole('link', { name: new RegExp(order.reference) })).toBeVisible()
})

test('a visitor writes a list, signs in without losing it, sends it and follows it', async ({ page, authMock }) => {
  await openApp(page, '/grocery', 'Grocery')
  await page.getByRole('link', { name: 'Start your grocery list' }).click()
  await expectPage(page, 'Your grocery list')
  await addItem(page, 'Basmati rice', '5')
  await addItem(page, 'Eggs', '1.5', 'dozen')
  await expect(page.getByText('2 of 50 items')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Sign in to add delivery details' })).toBeVisible()
  await page.getByRole('button', { name: 'Log in or create an account' }).click()
  await expectPage(page, 'Log In')
  await signIn(page, 'Ayesha Khan', 'resident')

  await expectPage(page, 'Delivery details') // back where they were
  await expect(page.getByText('2 items on your list.')).toBeVisible()
  await expect(page.getByLabel('Contact name')).toHaveValue('Ayesha Khan')
  await fillDelivery(page)
  await expect(page.getByText('There is no price yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Send my order' }).click()

  await expectPage(page, 'Order sent')
  const [order] = authMock.grocery.orders
  await expect(page.getByText(order.detail.reference)).toBeVisible()
  const [sent] = submissions(page)
  expect(submissions(page)).toHaveLength(1)
  expect(sent.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
  expect(sent.csrf).toBeTruthy()
  expect(sent.body).toEqual({
    items: [
      { name: 'Basmati rice', unit: 'kg', quantity: '5', substitution: 'ask' },
      { name: 'Eggs', unit: 'dozen', quantity: '1.5', substitution: 'ask' },
    ],
    delivery: { contactName: 'Ayesha Khan', contactPhone: '+923001234567', block: 'Test Block A', addressLine: 'House 17, Street 4' },
  })

  await page.getByRole('link', { name: 'Track this order' }).click()
  await expectPage(page, `Order ${order.detail.reference}`)
  await expect(page.getByRole('list', { name: 'Order progress' })).toBeVisible()
  await page.getByRole('main').getByRole('link', { name: 'My Grocery Orders' }).click()
  await expect(page.getByRole('list', { name: 'Your grocery orders' }).getByRole('listitem')).toHaveCount(1)

  // nothing about the order was written to the browser's storage
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
  for (const secret of ['Basmati', 'House 17', '923001234567', '0300', order.detail.reference]) expect(stored).not.toContain(secret)
})

test('after another tab switches accounts, “Send my order” creates nothing and shows them nothing of it', async ({ page, authMock }) => {
  await reviewReady(page)
  const other = authMock.addAccount({ email: emailFor('Bilal Ahmed'), displayName: 'Bilal Ahmed' })
  authMock.session = { email: other.email, csrf: 'csrf-of-the-other-tab' }

  await page.getByRole('button', { name: 'Send my order' }).click()

  await expect(page.getByText("You're now signed in as a different account")).toBeVisible()
  await expectPage(page, 'Your grocery list') // theirs, and empty
  for (const secret of ['House 17, Street 4', 'Basmati rice', '0300 1234567', 'Ayesha Khan']) {
    await expect(page.locator('body')).not.toContainText(secret)
  }
  expect(submissions(page)).toHaveLength(1) // refused, and not sent again
  expect(authMock.grocery.orders).toHaveLength(0)
})

test('an out-of-date secure session: the order is refused, kept, and sent only when pressed again', async ({ page, authMock }) => {
  await reviewReady(page)
  authMock.session = { email: emailFor('Ayesha Khan'), csrf: 'csrf-signed-in-again-elsewhere' }

  await page.getByRole('button', { name: 'Send my order' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('secure session could not be verified')
  await expect(page.getByRole('main')).toContainText('House 17, Street 4')
  expect(submissions(page)).toHaveLength(1)
  expect(authMock.grocery.orders).toHaveLength(0)

  await page.getByRole('button', { name: 'Send my order' }).click()
  await expectPage(page, 'Order sent')
  expect(submissions(page)).toHaveLength(2)
  expect(submissions(page)[1].csrf).toBe('csrf-signed-in-again-elsewhere')
  expect(authMock.grocery.orders).toHaveLength(1)
})

test('clicking send twice sends one request', async ({ page, authMock }) => {
  await reviewReady(page)
  const release = authMock.holdGrocerySubmit()

  const send = page.getByRole('button', { name: 'Send my order' })
  await send.dblclick()
  await expect(page.getByRole('button', { name: 'Sending your order…' })).toBeDisabled()
  release()

  await expectPage(page, 'Order sent')
  expect(submissions(page)).toHaveLength(1)
  expect(authMock.grocery.orders).toHaveLength(1)
})

for (const fault of ['lost-after', 'error-after'] as const) {
  test(`an unknown outcome (${fault}) survives navigating away and resends with the same key: one order`, async ({ page, authMock }) => {
    await reviewReady(page)
    authMock.grocerySubmitFaults.push(fault)
    await page.getByRole('button', { name: 'Send my order' }).click()

    const panel = page.getByRole('alert', { name: "We couldn't confirm your order" })
    await expect(panel).toBeInViewport() // not left off screen above the person
    await expect(page.getByRole('button', { name: 'Send my order' })).toHaveCount(0)
    await panel.getByRole('link', { name: 'Check My Grocery Orders' }).click()
    await expect(page.getByRole('list', { name: 'Your grocery orders' }).getByRole('listitem')).toHaveCount(1)
    await navigateInApp(page, '/grocery/new', 'Your grocery list')
    await expect(page.getByText(/haven't been able to confirm your last order/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove Basmati rice' })).toBeDisabled()
    await page.getByRole('link', { name: 'Go to review' }).click()
    await page.getByRole('button', { name: 'Send the same order again' }).click()

    await expectPage(page, 'Order sent')
    const sent = submissions(page)
    expect(sent).toHaveLength(2)
    expect(sent[1].idempotencyKey).toBe(sent[0].idempotencyKey)
    expect(sent[1].body).toEqual(sent[0].body)
    expect(authMock.grocery.orders).toHaveLength(1)
  })
}

test('a lost request that never arrived is also resent with its key', async ({ page, authMock }) => {
  await reviewReady(page)
  authMock.grocerySubmitFaults.push('lost-before')
  await page.getByRole('button', { name: 'Send my order' }).click()
  await page.getByRole('button', { name: 'Send the same order again' }).click()

  await expectPage(page, 'Order sent')
  expect(new Set(submissions(page).map((call) => call.idempotencyKey)).size).toBe(1)
  expect(authMock.grocery.orders).toHaveLength(1)
})

test('a refusal is explained and the list is kept', async ({ page, authMock }) => {
  await reviewReady(page)
  authMock.grocery.full = true // fills up while the customer was writing
  await page.getByRole('button', { name: 'Send my order' }).click()

  await expect(page.getByRole('alert').filter({ hasText: "Today's grocery order places are full" })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Send my order' })).toBeDisabled() // availability was re-read
  await expect(page.getByText('Basmati rice')).toBeVisible()
  expect(authMock.grocery.orders).toHaveLength(0)
})

test('an expired session hides the list until the same account signs in; signing out clears it', async ({ page, authMock }) => {
  await reviewReady(page)
  authMock.session = null // the server ends the session
  await page.getByRole('button', { name: 'Send my order' }).click()

  await expect(page.getByRole('heading', { name: 'Sign in to continue your list' })).toBeVisible()
  await expect(page.getByText('Basmati rice')).toHaveCount(0)
  await expect(page.getByText('House 17, Street 4')).toHaveCount(0)
  await page.getByRole('main').getByRole('button', { name: 'Log in', exact: true }).click()
  await expectPage(page, 'Log In')
  await signIn(page, 'Ayesha Khan', 'resident')
  await expectPage(page, 'Your grocery list')
  await expect(page.getByText('Basmati rice')).toBeVisible()

  await navigateInApp(page, '/profile', 'Ayesha Khan')
  await page.getByRole('button', { name: 'Log Out' }).click()
  await expect(page.getByRole('banner').getByRole('link', { name: 'Log in' })).toBeVisible()
  await navigateInApp(page, '/grocery/new', 'Your grocery list')
  await expect(page.getByText('0 of 50 items')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sign in to continue your list' })).toHaveCount(0)
})

test('another account never sees the previous one’s list or orders', async ({ page, authMock }) => {
  await reviewReady(page)
  authMock.grocery.seed(emailFor('Ayesha Khan'))
  authMock.session = null
  await page.getByRole('button', { name: 'Send my order' }).click()
  await page.getByRole('main').getByRole('button', { name: 'Log in', exact: true }).click()
  await signIn(page, 'Bilal Ahmed', 'resident')
  await expectPage(page, 'Your grocery list')

  await expect(page.getByText('0 of 50 items')).toBeVisible()
  await expect(page.getByText('Basmati rice')).toHaveCount(0)
  await navigateInApp(page, '/profile/grocery', 'My Grocery Orders')
  await expect(page.getByText('No grocery orders yet')).toBeVisible()
  await navigateInApp(page, `/profile/grocery/${authMock.grocery.orders[0].detail.id}`, 'Order not found')
})

test('private pages send a signed-out visitor to Log In', async ({ page }) => {
  await page.goto('/profile/grocery')
  await expectPage(page, 'Log In')
  await page.goto('/profile/grocery/22222222-2222-4222-8222-000000000001')
  await expectPage(page, 'Log In')
})

test('history, price and payment: totals, a reduction, cash due and cash collected', async ({ page, authMock }) => {
  const owner = emailFor('Ayesha Khan')
  authMock.addAccount({ email: owner, displayName: 'Ayesha Khan' })
  const due = authMock.grocery.seed(owner)
  authMock.grocery.staffConfirm(due.id)
  authMock.grocery.staffReduce(due.id, 200_000)
  const paid = authMock.grocery.seed(owner)
  authMock.grocery.staffConfirm(paid.id, 100_000, 0, 5_000)
  authMock.grocery.staffMove(paid.id, 'preparing')
  authMock.grocery.staffMove(paid.id, 'out_for_delivery')
  authMock.grocery.staffDeliver(paid.id)
  await openApp(page, '/login', 'Log In')
  await signIn(page, 'Ayesha Khan', 'resident')
  await expectPage(page)

  await navigateInApp(page, '/profile/grocery', 'My Grocery Orders')
  const list = page.getByRole('list', { name: 'Your grocery orders' })
  await expect(list.getByText('Rs 2,000 to pay in cash')).toBeVisible()
  await expect(list.getByText('Total Rs 1,050')).toBeVisible()
  await expect(list).not.toContainText('House 17')
  await page.getByRole('button', { name: 'Delivered', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await list.getByRole('link').click()
  await expect(page.getByText('Paid in cash: Rs 1,050')).toBeVisible()

  await navigateInApp(page, `/profile/grocery/${due.id}`, `Order ${due.reference}`)
  const price = page.getByRole('region', { name: 'Price and payment' })
  await expect(price).toContainText('Recorded total')
  await expect(price).toContainText('Reduced by')
  await expect(price).toContainText('Cash on delivery: Rs 2,000')
  await expect(price).toContainText('Recorded by our team after a phone call')
})

test('cancelling: a stale order is reloaded, and a fresh one is cancelled', async ({ page, authMock }) => {
  const owner = emailFor('Ayesha Khan')
  authMock.addAccount({ email: owner, displayName: 'Ayesha Khan' })
  const stale = authMock.grocery.seed(owner)
  const fresh = authMock.grocery.seed(owner)
  await openApp(page, '/login', 'Log In')
  await signIn(page, 'Ayesha Khan', 'resident')
  await expectPage(page)

  await navigateInApp(page, `/profile/grocery/${stale.id}`, `Order ${stale.reference}`)
  await page.getByRole('button', { name: 'Cancel order' }).click()
  authMock.grocery.staffConfirm(stale.id)
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click()
  await expect(page.getByText(/This order can no longer be cancelled —/)).toBeVisible()
  await expect(page.getByText('Cash on delivery: Rs 2,100')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0)

  await navigateInApp(page, `/profile/grocery/${fresh.id}`, `Order ${fresh.reference}`)
  await page.getByRole('button', { name: 'Cancel order' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click()
  await expect(page.getByText(/You cancelled it on/)).toBeVisible()
  expect(authMock.grocery.orders.map((order) => order.detail.status)).toEqual(['confirmed', 'cancelled'])
})

test('the keyboard can add items: Enter adds and returns to the item name', async ({ page }) => {
  await openApp(page, '/grocery/new', 'Your grocery list')
  const name = page.getByRole('region', { name: 'Add an item' }).getByLabel('Item', { exact: true })
  await name.fill('Milk')
  await name.press('Tab')
  await page.keyboard.type('2')
  await page.keyboard.press('Enter')

  await expect(page.getByRole('list', { name: 'Grocery items' }).getByText('Milk')).toBeVisible()
  await expect(name).toBeFocused()
  await expect(name).toHaveValue('')
})

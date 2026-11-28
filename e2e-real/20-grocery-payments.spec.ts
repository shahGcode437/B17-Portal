import { expect, test, type Page } from '@playwright/test'
import type { GroceryOrderCreateDto } from '../src/lib/api/dto/grocery'
import { GroceryBackend } from '../src/test/fixtures/groceryBackend'
import { GroceryStaffBackend } from '../src/test/fixtures/groceryStaffBackend'
import { ApiClient, WEB_API, createUser, expectH1, rows, scalar, signInAs, type TestUser } from './helpers/stack'

/**
 * GROCERY-4C against the REAL stack: payment methods and all of B-17 from the settings screen, a
 * verified early payment, delivery of a paid order, one payment under a double send, the Super
 * Admin's refund, privacy, and whether the mocked lane's fakes refuse like the API.
 *
 * THROWAWAY DATABASE ONLY, like specs 18 and 19: run with `P12I_KEEP=1` and drop it. No money moves
 * and no payment service is contacted: the application only records what staff say they checked.
 */
test.describe.configure({ mode: 'serial' })
test.skip(process.env.P12I_KEEP !== '1', 'Grocery orders cannot be cleaned up: use a throwaway database and P12I_KEEP=1')

const BLOCK = 'Test Block A'
const SECOND_BLOCK = 'Test Block B'
const TOTAL = 210_000
const AGREEMENT = { itemsSubtotalPaisa: TOTAL, agreedTotalPaisa: TOTAL, customerAgreed: true, method: 'phone_call', substitutionsAgreed: false }
const EVERY_DAY = { operatingDays: [1, 2, 3, 4, 5, 6, 7], opensAt: '00:00', closesAt: '23:59' }
let boss: TestUser
let clerk: TestUser
let buyer: TestUser

async function as(user: TestUser): Promise<ApiClient> {
  const api = await ApiClient.create()
  await api.login(user.email) // a new session each time: staff changes need a recent sign-in
  return api
}

async function settings(change: Record<string, unknown>) {
  const api = await as(boss)
  const now = await api.call('GET', '/admin/grocery/settings')
  const saved = await api.call('PATCH', '/admin/grocery/settings', { revision: now.body!.data.revision, ...change })
  await api.dispose()
  expect(saved.status, JSON.stringify(saved.body)).toBe(200)
  return saved.body!.data
}

let serial = 0
const key = () => `g4c-key-${Date.now()}-${(serial += 1)}`
const orderBody = () => ({
  items: [{ name: 'Basmati rice', unit: 'kg', quantity: '2', substitution: 'ask' }],
  delivery: { contactName: 'Test Customer', contactPhone: '+923001234567', block: BLOCK, addressLine: 'House 17, Street 4' },
})

/** A new order of `customer`, claimed and confirmed by `staff` through the real API. */
async function confirmed(customer: TestUser, staff: ApiClient): Promise<{ id: string; reference: string }> {
  const api = await as(customer)
  const sent = await api.call('POST', '/grocery/orders', orderBody(), { 'Idempotency-Key': key() })
  expect(sent.status, JSON.stringify(sent.body)).toBe(201)
  await api.dispose()
  const { id, reference } = sent.body!.data as { id: string; reference: string }
  expect((await staff.call('POST', `/admin/grocery/orders/${id}/claim`)).status).toBe(200)
  const agreed = await staff.call('POST', `/admin/grocery/orders/${id}/confirm`, { revision: 1, ...AGREEMENT })
  expect(agreed.status, JSON.stringify(agreed.body)).toBe(200)
  return { id, reference }
}

const statusOf = (id: string) => scalar(`SELECT status FROM grocery_orders WHERE id = '${id}'`)
const paymentsOf = (id: string) => rows(`SELECT method, amount_collected_paisa, coalesce(reference, '-') FROM grocery_payments WHERE order_id = '${id}'`)
const reason = (response: Awaited<ReturnType<ApiClient['call']>>) =>
  [response.status, response.body?.error?.code ?? null, (response.body?.error?.details ?? []).map((d) => `${d.field}:${d.code}`).join(',')]

const actions = (page: Page) => page.getByRole('region', { name: 'Actions' })
const dialog = (page: Page) => page.getByRole('dialog')
const money = (page: Page) => page.getByRole('region', { name: 'Amount due and payment' })

async function act(page: Page, action: string, send: string, fill?: () => Promise<void>) {
  await actions(page).getByRole('button', { name: action, exact: true }).click()
  await expect(dialog(page)).toBeVisible()
  await fill?.()
  await dialog(page).getByRole('button', { name: send, exact: true }).click()
  await expect(dialog(page)).toBeHidden()
}

test.beforeAll(async () => {
  boss = await createUser('g4c-boss', { admin: true })
  clerk = await createUser('g4c-clerk')
  buyer = await createUser('g4c-buyer')
  await settings({
    enabled: true,
    serviceableBlocks: [BLOCK],
    dailyCapacity: 200,
    maxActiveOrdersPerCustomer: 10,
    paymentMethods: ['cash_on_delivery'],
    coversAllB17: false,
    ...EVERY_DAY,
  })
  const api = await as(boss)
  const appointed = await api.call('POST', '/admin/staff/moderators', { email: clerk.email, scopes: ['grocery'], revision: 0 })
  expect(appointed.status, JSON.stringify(appointed.body)).toBe(201)
  await api.dispose()
})

test('a Super Admin confirms the blocks cover all of B-17 and switches methods on, from the settings screen', async ({ browser, page }) => {
  await page.goto('/grocery')
  await expect(page.getByText('Pay in cash when your order arrives.').first()).toBeVisible()
  await expect(page.locator('main')).not.toContainText(/all sectors|anywhere in B-17|Pay your way|easypaisa/i)

  const admin = await signInAs(browser, boss, '/admin/grocery/settings')
  await expectH1(admin, 'Grocery settings')
  await admin.getByLabel('Add a block').fill(SECOND_BLOCK)
  await admin.getByRole('button', { name: 'Add', exact: true }).click()
  await admin.getByLabel('The listed blocks cover all sectors and blocks of B-17').check()
  await admin.getByLabel('Easypaisa', { exact: true }).check()
  await admin.getByLabel('Card', { exact: true }).check()
  await admin.getByRole('button', { name: 'Review changes' }).click()
  await dialog(admin).getByRole('button', { name: 'Save settings' }).click()
  await expect(dialog(admin)).toBeHidden()
  await expect
    .poll(() => scalar("SELECT array_to_string(payment_methods, ',') || ' ' || covers_all_b17 FROM grocery_settings_revisions ORDER BY revision DESC LIMIT 1"))
    .toBe('cash_on_delivery,card,easypaisa true')
  await admin.context().close()

  await page.reload()
  await expect(page.getByText('Delivering across all sectors and blocks of B-17, Islamabad.')).toBeVisible()
  await expect(page.getByText('Receive your groceries conveniently at your doorstep anywhere in B-17.')).toBeVisible()
  await expect(page.getByText('Pay using our available cash, card or online payment options.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Ways to pay' }).getByRole('listitem')).toHaveText(['Cash on delivery', 'Card on delivery', 'Easypaisa'])

  // The confirmation lets nobody order outside the list.
  const api = await as(buyer)
  const outside = await api.call('POST', '/grocery/orders', { ...orderBody(), delivery: { ...orderBody().delivery, block: 'Somewhere Else' } }, { 'Idempotency-Key': key() })
  expect(reason(outside)).toEqual([422, 'validation_error', 'delivery.block:not_serviceable'])
  await api.dispose()
})

test('an early Easypaisa payment is recorded once verified, the paid order is delivered with nothing collected again', async ({ browser }) => {
  const staffApi = await as(clerk)
  const order = await confirmed(buyer, staffApi)

  const staff = await signInAs(browser, clerk, `/admin/grocery/${order.id}`)
  await expectH1(staff, `Order ${order.reference}`)
  await act(staff, 'Record payment', 'Record payment', async () => {
    await expect(dialog(staff).getByRole('radio')).toHaveCount(2)
    await dialog(staff).getByRole('radio', { name: 'Easypaisa' }).check()
    await dialog(staff).getByLabel('Amount received (Rs)').fill('2100')
    await dialog(staff).getByLabel('Transaction reference').fill('ep 5566-7788')
    await dialog(staff).getByRole('checkbox', { name: /I checked that this money was received/ }).check()
  })
  await expect(money(staff)).toContainText('Paid with Easypaisa: Rs 2,100')
  await expect(money(staff)).toContainText('Reference: EP55667788')
  expect(statusOf(order.id)).toBe('confirmed') // paying delivers nothing
  expect(paymentsOf(order.id)).toEqual([['easypaisa', String(TOTAL), 'EP55667788']])
  await expect(actions(staff).getByRole('button', { name: /Cancel order|Lower amount due|Record new agreement|Record refund/ })).toHaveCount(0)

  const mine = await signInAs(browser, buyer, `/profile/grocery/${order.id}`)
  await expect(mine.getByText('Paid with Easypaisa: Rs 2,100')).toBeVisible()
  await expect(mine.locator('body')).toContainText("It isn't delivered yet")
  await expect(mine.locator('body')).not.toContainText(/5566|7788|EP5566/)

  // A paid order keeps its amount, and only a Super Admin records a refund.
  const revision = Number(scalar(`SELECT revision FROM grocery_orders WHERE id = '${order.id}'`))
  const reduced = await staffApi.call('POST', `/admin/grocery/orders/${order.id}/reduce-amount`, { revision, finalAmountPaisa: 100, reason: 'Short' })
  expect(reason(reduced).slice(0, 2)).toEqual([409, 'payment_recorded'])
  const refund = { revision, amountPaisa: TOTAL, method: 'cash', reason: 'x', moneyReturned: true }
  expect(reason(await staffApi.call('POST', `/admin/grocery/orders/${order.id}/refund`, refund))).toEqual([403, 'forbidden', 'order:super_admin_required'])

  await staff.reload()
  await act(staff, 'Start preparing', 'Start preparing')
  await actions(staff).getByRole('button', { name: 'Send out for delivery' }).click()
  await expect(dialog(staff)).toContainText('Already paid. Collect nothing')
  await dialog(staff).getByRole('button', { name: 'Out for delivery' }).click()
  await expect(dialog(staff)).toBeHidden()
  await act(staff, 'Record delivery', 'Record delivered', async () => {
    await expect(dialog(staff).getByLabel('Cash you collected (Rs)')).toHaveCount(0)
    await dialog(staff).getByRole('checkbox', { name: 'The order was handed over.' }).check()
  })
  await expect.poll(() => statusOf(order.id)).toBe('delivered')
  expect(paymentsOf(order.id)).toHaveLength(1)

  await mine.reload()
  await expect(mine.getByText('Paid with Easypaisa: Rs 2,100')).toBeVisible()
  await mine.context().close()
  await staff.context().close()
  await staffApi.dispose()
})

test('two payments sent at once make one; a card number and a reused transaction are refused', async () => {
  const staffApi = await as(clerk)
  const order = await confirmed(await createUser('g4c-twice'), staffApi)
  const [first, second] = [await as(boss), await as(boss)]
  const payment = (method: string, reference: string) => ({ revision: 2, method, amountPaisa: TOTAL, reference, moneyVerified: true })

  const card = await first.call('POST', `/admin/grocery/orders/${order.id}/record-payment`, payment('card', '4111 1111 1111 1111'))
  expect(reason(card)).toEqual([422, 'validation_error', 'reference:looks_like_card_number'])
  expect(JSON.stringify(card.body)).not.toContain('4111')
  const reused = await first.call('POST', `/admin/grocery/orders/${order.id}/record-payment`, payment('easypaisa', 'EP-5566-7788'))
  expect(reason(reused)).toEqual([422, 'validation_error', 'reference:reference_in_use'])

  const answers = await Promise.all([
    first.call('POST', `/admin/grocery/orders/${order.id}/record-payment`, payment('card', 'SLIP-100001')),
    second.call('POST', `/admin/grocery/orders/${order.id}/record-payment`, payment('easypaisa', 'EP-100002')),
  ])
  expect(answers.map((a) => a.status).sort()).toEqual([200, 409])
  expect(paymentsOf(order.id)).toHaveLength(1)
  await first.dispose()
  await second.dispose()
  await staffApi.dispose()
})

test('a Super Admin records the refund of an order being prepared: it is cancelled, the payment kept', async ({ browser }) => {
  const customer = await createUser('g4c-refund')
  const staffApi = await as(clerk)
  const order = await confirmed(customer, staffApi)
  expect((await staffApi.call('POST', `/admin/grocery/orders/${order.id}/record-payment`, { revision: 2, method: 'card', amountPaisa: TOTAL, reference: 'SLIP-200001', moneyVerified: true })).status).toBe(200)
  expect((await staffApi.call('POST', `/admin/grocery/orders/${order.id}/start-preparing`, { revision: 3 })).status).toBe(200)

  const admin = await signInAs(browser, boss, `/admin/grocery/${order.id}`)
  await expectH1(admin, `Order ${order.reference}`)
  await act(admin, 'Record refund', 'Record refund and cancel order', async () => {
    await dialog(admin).getByLabel('Amount returned (Rs)').fill('2100')
    await dialog(admin).getByRole('radio', { name: 'Back to the card' }).check()
    await dialog(admin).getByLabel('Refund reference').fill('RF-200001')
    await dialog(admin).getByLabel('Reason').fill('INTERNAL shop could not supply')
    await dialog(admin).getByRole('checkbox', { name: /whole amount has been returned/ }).check()
    await dialog(admin).getByRole('checkbox', { name: /goods may already have been bought/ }).check()
  })
  await expect(money(admin)).toContainText('Refunded: Rs 2,100, to the card')
  await expect(money(admin)).toContainText('Paid by card: Rs 2,100')
  expect(statusOf(order.id)).toBe('cancelled')
  expect(paymentsOf(order.id)).toHaveLength(1)
  expect(rows(`SELECT amount_paisa, method, reference FROM grocery_refunds WHERE order_id = '${order.id}'`)).toEqual([[String(TOTAL), 'card', 'RF200001']])
  await admin.context().close()

  const api = await as(boss)
  const revision = Number(scalar(`SELECT revision FROM grocery_orders WHERE id = '${order.id}'`))
  const again = await api.call('POST', `/admin/grocery/orders/${order.id}/refund`, { revision, amountPaisa: TOTAL, method: 'cash', reason: 'x', moneyReturned: true })
  expect(again.status).toBe(409)
  await api.dispose()

  const mine = await signInAs(browser, customer, `/profile/grocery/${order.id}`)
  await expect(mine.getByText('Refunded: Rs 2,100')).toBeVisible()
  await expect(mine.locator('body')).not.toContainText(/INTERNAL|SLIP|RF200001/)
  await mine.goto('/profile/grocery')
  await expect(mine.getByText('Payment refunded')).toBeVisible()
  await mine.context().close()

  const stranger = await signInAs(browser, await createUser('g4c-stranger'), `/profile/grocery/${order.id}`)
  await expectH1(stranger, 'Order not found')
  await stranger.context().close()
  await staffApi.dispose()
})

test('changing the blocks removes the all-of-B-17 statement until it is confirmed again', async ({ page }) => {
  const changed = await settings({ serviceableBlocks: [BLOCK] })
  expect(changed.coversAllB17).toBe(false)
  await page.goto('/grocery')
  await expect(page.getByRole('list', { name: 'Blocks we deliver to' }).getByRole('listitem')).toHaveText([BLOCK])
  await expect(page.locator('main')).not.toContainText(/all sectors|anywhere in B-17/i)
})

/** Every key of an answer, nested; arrays by their first element. Values are not compared. */
function shape(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.length ? shape(value[0], `${path}[]`) : [`${path}[]`]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => shape(v, path ? `${path}.${k}` : k)).sort()
  return [path]
}

test('the mocked lane answers payments and refunds like the real API', async () => {
  await settings({ paymentMethods: ['cash_on_delivery', 'card', 'bank_transfer'] })
  const customer = await createUser('g4c-parity')
  const staffApi = await as(boss)
  const real = await confirmed(customer, staffApi)

  const fake = new GroceryBackend()
  fake.paymentMethods = ['cash_on_delivery', 'card', 'bank_transfer']
  const staffFake = new GroceryStaffBackend(fake)
  const viewer = { id: 'parity-staff', displayName: 'Parity Staff', ownerKey: 'staff', superAdmin: true, groceryScope: false, emailVerified: true }
  // The same order on both sides, so any difference in shape is the API's, not the setup's.
  const sent = orderBody()
  const mockId = fake.seed('parity', {
    items: sent.items as GroceryOrderCreateDto['items'],
    delivery: { ...sent.delivery, block: fake.blocks[0]! },
  }).id
  // Claimed and confirmed through the fake's staff API, as the real one is.
  for (const [operation, body] of [['claim', {}], ['confirm', { revision: 1, ...AGREEMENT }]] as const) {
    expect((staffFake.route('POST', `/admin/grocery/orders/${mockId}/${operation}`, new URLSearchParams(), body, viewer) as { status: number }).status).toBe(200)
  }

  type Answer = { status: number; body: any }
  const both = async (operation: string, body: Record<string, unknown>, what: string): Promise<[Answer, Answer]> => {
    const a = (await staffApi.call('POST', `/admin/grocery/orders/${real.id}/${operation}`, body)) as unknown as Answer
    const b = staffFake.route('POST', `/admin/grocery/orders/${mockId}/${operation}`, new URLSearchParams(), body, viewer) as Answer
    expect([a.status, a.body.error?.code], what).toEqual([b.status, b.body.error?.code])
    expect((a.body.error?.details ?? []).map((d: any) => `${d.field}:${d.code}`).sort(), `${what}: details`).toEqual(
      (b.body.error?.details ?? []).map((d: any) => `${d.field}:${d.code}`).sort(),
    )
    return [a, b]
  }
  const pay = { revision: 2, method: 'bank_transfer', amountPaisa: TOTAL, reference: `TID-${Date.now()}`, moneyVerified: true }

  await both('record-payment', { ...pay, method: 'easypaisa' }, 'a method switched off')
  await both('record-payment', { ...pay, method: 'cash_on_delivery' }, 'cash')
  await both('record-payment', { ...pay, amountPaisa: TOTAL - 1 }, 'a part payment')
  await both('record-payment', { ...pay, reference: '5500005555555559' }, 'a card number')
  await both('record-payment', { ...pay, moneyVerified: false }, 'unverified')
  await both('record-payment', { ...pay, revision: 1 }, 'a stale screen')
  const [paid, mockPaid] = await both('record-payment', pay, 'the payment')
  expect(shape(paid.body.data), 'a paid staff order').toEqual(shape(mockPaid.body.data))
  await both('record-payment', { ...pay, revision: 3 }, 'a second payment')
  await both('cancel', { revision: 3, reason: 'x' }, 'cancelling a paid order')

  const refund = { revision: 3, amountPaisa: TOTAL, method: 'bank_transfer', reference: 'RF-PARITY-1', reason: 'x', moneyReturned: true }
  await both('refund', { ...refund, amountPaisa: TOTAL - 1 }, 'a partial refund')
  await both('refund', { ...refund, reference: undefined }, 'no reference')
  await both('refund', { ...refund, moneyReturned: false }, 'not yet returned')
  const [refunded, mockRefunded] = await both('refund', refund, 'the refund')
  expect(shape(refunded.body.data), 'a refunded staff order').toEqual(shape(mockRefunded.body.data))
  await both('refund', { ...refund, revision: 4 }, 'a second refund')

  const mine = await as(customer)
  const realMine = (await mine.call('GET', `/grocery/orders/${real.id}`)).body!.data
  const fakeMine = fake.route('GET', `/grocery/orders/${mockId}`, new URLSearchParams(), undefined, null, { key: 'parity', emailVerified: true }) as Answer
  expect(shape(realMine), 'a refunded customer order').toEqual(shape(fakeMine.body.data))
  const realAvailability = (await mine.call('GET', '/grocery/availability')).body!.data
  expect(shape(realAvailability), 'availability').toEqual(
    shape((fake.route('GET', '/grocery/availability', new URLSearchParams(), undefined, null, null) as Answer).body.data),
  )
  await mine.dispose()
  await staffApi.dispose()
  expect((await (await fetch(`${WEB_API}/grocery/availability`)).json()).data.paymentMethods).toEqual(['cash_on_delivery', 'card', 'bank_transfer'])
})

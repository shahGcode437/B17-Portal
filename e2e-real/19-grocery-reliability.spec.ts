import { expect, test, type Browser, type Page } from '@playwright/test'
import { AdminBackend, MemoryDirectory } from '../src/test/fixtures/adminBackend'
import { GroceryBackend } from '../src/test/fixtures/groceryBackend'
import { GroceryStaffBackend } from '../src/test/fixtures/groceryStaffBackend'
import { ApiClient, PASSWORD, WEB_API, createUser, expectH1, newContext, scalar, signInAs, type TestUser } from './helpers/stack'

/**
 * GROCERY-4B against the REAL stack: what `18-grocery.spec.ts` doesn't cover. Hours and coverage
 * from the settings, duplicate and lost submissions, recovery after a reload, the day's capacity,
 * the rest of the staff journey, privacy, and whether the mocked lane's fakes answer like the API.
 *
 * THROWAWAY DATABASE ONLY, like spec 18 (same reason): run with `P12I_KEEP=1` and drop it. The hours
 * it sets cover "now" or exclude it as each test needs; the clock itself is never faked, so the
 * second-exact boundaries are the backend tests' job (`test_grocery_settings_api.py`).
 */
test.describe.configure({ mode: 'serial' })
test.skip(process.env.P12I_KEEP !== '1', 'Grocery orders cannot be cleaned up: use a throwaway database and P12I_KEEP=1')

const BLOCK = 'Test Block A'
const ALWAYS = { operatingDays: [1, 2, 3, 4, 5, 6, 7], opensAt: '00:00', closesAt: '23:59' }
let boss: TestUser
let runner: TestUser

async function as(user: TestUser): Promise<ApiClient> {
  const api = await ApiClient.create()
  await api.login(user.email)
  return api
}

/** One settings change through the real API, on the version read just before. */
async function settings(change: Record<string, unknown>) {
  const api = await as(boss)
  const now = await api.call('GET', '/admin/grocery/settings')
  const saved = await api.call('PATCH', '/admin/grocery/settings', { revision: now.body!.data.revision, ...change })
  await api.dispose()
  return saved
}

const orderBody = (item = 'Basmati rice', block = BLOCK) => ({
  items: [{ name: item, unit: 'kg', quantity: '2', substitution: 'ask' }],
  delivery: { contactName: 'Test Customer', contactPhone: '+923001234567', block, addressLine: 'House 17, Street 4' },
})
let serial = 0
const key = () => `p12i-key-${Date.now()}-${(serial += 1)}`
const send = (api: ApiClient, body = orderBody(), idempotencyKey = key()) =>
  api.call('POST', '/grocery/orders', body, { 'Idempotency-Key': idempotencyKey })
const idOf = (user: TestUser) => scalar(`SELECT id FROM users WHERE email = '${user.email}'`)
const ordersOf = (user: TestUser) => Number(scalar(`SELECT count(*) FROM grocery_orders WHERE customer_id = '${idOf(user)}'`))
const statusOf = (id: string) => scalar(`SELECT status FROM grocery_orders WHERE id = '${id}'`)
const reservedToday = () =>
  Number(scalar(`SELECT coalesce(max(reserved), 0) FROM grocery_daily_capacity WHERE service_date = (now() AT TIME ZONE 'Asia/Karachi')::date`))
const reason = (response: { status: number; body: { error?: { code: string } } | null }) => [response.status, response.body?.error?.code ?? null]

test.beforeAll(async () => {
  boss = await createUser('g4b-boss', { admin: true })
  runner = await createUser('g4b-runner')
  const on = await settings({ enabled: true, serviceableBlocks: [BLOCK], dailyCapacity: 100, ...ALWAYS })
  expect(on.status, JSON.stringify(on.body)).toBe(200)
  const api = await as(boss)
  const appointed = await api.call('POST', '/admin/staff/moderators', { email: runner.email, scopes: ['grocery'], revision: 0 })
  expect(appointed.status, JSON.stringify(appointed.body)).toBe(201)
  await api.dispose()
})

test('the approved hours are saved, read back and shown as midnight; outside the hours nothing is accepted', async ({ page }) => {
  const approved = await settings({ operatingDays: [1, 2, 3, 4, 5, 6, 7], opensAt: '08:00', closesAt: '00:00' })
  expect(approved.status, JSON.stringify(approved.body)).toBe(200)
  expect(approved.body!.data).toMatchObject({ opensAt: '08:00', closesAt: '00:00' })
  expect(scalar('SELECT closes_at FROM grocery_settings_revisions ORDER BY revision DESC LIMIT 1')).toBe('23:59:59.999999')
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  const availability = (await (await page.request.get(`${WEB_API}/grocery/availability`)).json()).data
  expect(availability.schedule).toMatchObject({ opensAt: '08:00', closesAt: '00:00', timezone: 'Asia/Karachi' })
  expect(availability.acceptingOrders).toBe(hour >= 8)

  await page.goto('/grocery')
  await expect(page.getByText('Every day — 8:00 AM to 12:00 Midnight (Pakistan time).')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Blocks we deliver to' }).getByRole('listitem')).toHaveText([BLOCK])
  await expect(page.locator('main')).not.toContainText(/local shops|price list|paid online|all sectors|anywhere in B-17/i)

  expect(reason((await settings({ opensAt: '00:00', closesAt: '00:00' })) as never)).toEqual([422, 'validation_error'])

  // Hours that certainly exclude this moment.
  const away = (hour + 6) % 22
  const two = (n: number) => String(n).padStart(2, '0')
  expect((await settings({ opensAt: `${two(away)}:00`, closesAt: `${two(away + 1)}:00` })).status).toBe(200)
  const buyer = await createUser('g4b-closed')
  const api = await as(buyer)
  expect(reason(await send(api))).toEqual([409, 'grocery_closed'])
  expect(ordersOf(buyer)).toBe(0)
  await api.dispose()
  expect((await settings(ALWAYS)).status).toBe(200)
})

test('only a listed block is accepted, and one key makes one order', async () => {
  const buyer = await createUser('g4b-keys')
  const api = await as(buyer)
  const outside = await send(api, orderBody('Eggs', 'Somewhere Else'))
  expect(reason(outside)).toEqual([422, 'validation_error'])
  expect(outside.body!.error!.details).toMatchObject([{ field: 'delivery.block', code: 'not_serviceable' }])
  expect(ordersOf(buyer)).toBe(0)

  const same = key()
  const first = await send(api, orderBody(), same)
  const again = await send(api, orderBody(), same)
  expect([first.status, again.status]).toEqual([201, 200])
  expect(again.body!.data.id).toBe(first.body!.data.id)
  expect(reason(await send(api, orderBody('Milk'), same))).toEqual([409, 'idempotency_key_reused'])
  expect(ordersOf(buyer)).toBe(1)
  await api.dispose()
})

async function writeOrder(page: Page) {
  await page.goto('/grocery/new')
  await expectH1(page, 'Your grocery list')
  const form = page.getByRole('region', { name: 'Add an item' })
  await form.getByLabel('Item', { exact: true }).fill('Basmati rice')
  await form.getByLabel('Quantity').fill('5')
  await form.getByLabel('Unit').selectOption('kg')
  await form.getByRole('button', { name: 'Add to list' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expectH1(page, 'Delivery details')
  await page.getByLabel('Phone number').fill('0300 1234567')
  await page.getByLabel('Block').selectOption(BLOCK)
  await page.getByLabel('House and street').fill('House 17, Street 4')
  await page.getByRole('button', { name: 'Review order' }).click()
  await expectH1(page, 'Check your order')
}

/** The next submission reaches the server; its answer never reaches the page. */
async function loseTheNextAnswer(page: Page) {
  let lost = false
  await page.route('**/api/v1/grocery/orders', async (route) => {
    if (lost || route.request().method() !== 'POST') return route.fallback()
    lost = true
    const reached = await route.fetch()
    expect(reached.status()).toBe(201)
    await route.abort('connectionreset')
  })
}

test('a lost answer: nothing is resent by itself, and sending the same order again makes no second one', async ({ browser }) => {
  const buyer = await createUser('g4b-lost')
  const page = await signInAs(browser, buyer, '/grocery')
  await writeOrder(page)
  await loseTheNextAnswer(page)
  const posts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/v1/grocery/orders')) posts.push(request.headers()['idempotency-key']!)
  })
  await page.getByRole('button', { name: 'Send my order' }).click()
  await expect(page.getByRole('alert').filter({ hasText: "We couldn't confirm your order" })).toBeVisible()
  await page.waitForTimeout(1_500) // on purpose: an automatic resend would happen in this time
  expect(posts).toHaveLength(1)
  expect(ordersOf(buyer)).toBe(1)

  await page.getByRole('button', { name: 'Send the same order again' }).click()
  await expectH1(page, 'Order sent')
  expect(posts).toHaveLength(2)
  expect(posts[1]).toBe(posts[0])
  expect(ordersOf(buyer)).toBe(1)
  expect(await page.evaluate(() => sessionStorage.length + localStorage.length)).toBe(0)
  await page.context().close()
})

test('a reload during an unknown send: the same account is shown the order that arrived; another account sees nothing', async ({ browser }) => {
  const buyer = await createUser('g4b-reload')
  const stranger = await createUser('g4b-stranger')
  const page = await signInAs(browser, buyer, '/grocery')
  await writeOrder(page)
  await loseTheNextAnswer(page)
  await page.getByRole('button', { name: 'Send my order' }).click()
  await expect(page.getByRole('button', { name: 'Send the same order again' })).toBeVisible()
  const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }))
  for (const secret of ['Basmati', 'House 17', '923001234567', PASSWORD]) expect(stored).not.toContain(secret)

  page.once('dialog', (dialog) => void dialog.accept()) // the app asks before leaving an unknown send
  await page.goto('/grocery')
  const reference = scalar(`SELECT reference FROM grocery_orders WHERE customer_id = '${idOf(buyer)}'`)
  const notice = page.getByRole('region', { name: 'Check your last order before sending another' })
  await expect(notice).toContainText(`We found an order received around then: ${reference}`)
  expect(ordersOf(buyer)).toBe(1)
  await notice.getByRole('button', { name: "I've checked my orders" }).click()
  await expect(notice).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)

  // Another account in the same tab, after a second unfinished send, learns nothing of it.
  await writeOrder(page)
  await loseTheNextAnswer(page)
  await page.getByRole('button', { name: 'Send my order' }).click()
  await expect(page.getByRole('button', { name: 'Send the same order again' })).toBeVisible()
  await page.context().clearCookies()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.goto('/login')
  await page.getByLabel('Email').fill(stranger.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toHaveCount(0)
  await page.goto('/grocery')
  await expect(page.getByRole('heading', { level: 1, name: 'Grocery' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Check your last order before sending another' })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(reference)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
  await page.context().close()
})

test('the day has only its places: the last one is taken once, and a cancelled order keeps its place', async () => {
  const [one, two] = [await createUser('g4b-cap-one'), await createUser('g4b-cap-two')]
  const [first, second] = [await as(one), await as(two)]
  expect((await settings({ dailyCapacity: reservedToday() + 1 })).status).toBe(200)

  const both = await Promise.all([send(first), send(second)])

  expect(both.map((response) => response.status).sort()).toEqual([201, 409])
  expect(both.find((response) => response.status === 409)!.body!.error!.code).toBe('grocery_capacity_reached')
  const winner = both[0]!.status === 201 ? { api: first, other: second, order: both[0]!.body!.data } : { api: second, other: first, order: both[1]!.body!.data }
  expect((await winner.api.call('POST', `/grocery/orders/${winner.order.id}/cancel`, { revision: winner.order.revision })).status).toBe(200)
  expect(reason(await send(winner.other))).toEqual([409, 'grocery_capacity_reached'])
  const availability = await winner.api.call('GET', '/grocery/availability')
  expect(availability.body!.data).toMatchObject({ acceptingOrders: false, unavailableReason: 'daily_limit_reached' })

  expect((await settings({ dailyCapacity: 100 })).status).toBe(200)
  expect(reason(await send(winner.other))).toEqual([201, null])
  expect((await settings({ enabled: false })).status).toBe(200)
  expect(reason(await send(winner.api))).toEqual([503, 'grocery_unavailable'])
  expect((await settings({ enabled: true })).status).toBe(200)
  await first.dispose()
  await second.dispose()
})

const dialog = (page: Page) => page.getByRole('dialog')
async function act(page: Page, action: string, submit: string, fill?: () => Promise<void>) {
  await page.getByRole('button', { name: action, exact: true }).first().click()
  await expect(dialog(page)).toBeVisible()
  await fill?.()
  await dialog(page).getByRole('button', { name: submit, exact: true }).click()
  await expect(dialog(page)).toBeHidden()
}

const AGREEMENT = {
  itemsSubtotalPaisa: 200_000, serviceFeePaisa: 10_000, deliveryFeePaisa: 15_000, agreedTotalPaisa: 225_000,
  customerAgreed: true, method: 'phone_call', substitutionsAgreed: false,
}

async function placeAndClaim(buyer: TestUser, staff: ApiClient): Promise<{ id: string; reference: string }> {
  const api = await as(buyer)
  const sent = await send(api)
  expect(sent.status, JSON.stringify(sent.body)).toBe(201)
  await api.dispose()
  const claimed = await staff.call('POST', `/admin/grocery/orders/${sent.body!.data.id}/claim`)
  expect(claimed.status).toBe(200)
  return sent.body!.data
}

test('staff: a lower amount, a failed delivery, a second try, an issue, and cash for the new amount', async ({ browser }) => {
  const buyer = await createUser('g4b-flow')
  const api = await as(runner)
  const order = await placeAndClaim(buyer, api)
  expect((await api.call('POST', `/admin/grocery/orders/${order.id}/confirm`, { revision: 1, ...AGREEMENT })).status).toBe(200)

  const page = await signInAs(browser, runner, `/admin/grocery/${order.id}`)
  await expectH1(page, `Order ${order.reference}`)
  await act(page, 'Lower amount due', 'Lower amount', async () => {
    await dialog(page).getByLabel('New amount due (Rs)').fill('2,000')
    await dialog(page).getByLabel('Reason').fill('INTERNAL one item was unavailable')
  })
  await act(page, 'Start preparing', 'Start preparing')
  await act(page, 'Send out for delivery', 'Out for delivery')
  await act(page, 'Record failed delivery', 'Record failed delivery', async () => {
    await dialog(page).getByLabel('Reason').fill('INTERNAL gate was locked')
  })
  expect(statusOf(order.id)).toBe('preparing')
  await act(page, 'Record issue', 'Record issue', async () => {
    await dialog(page).getByRole('radio', { name: 'Customer unreachable' }).check()
    await dialog(page).getByLabel('What happened').fill('INTERNAL no answer on the phone')
  })
  await act(page, 'Send out for delivery', 'Out for delivery')
  await act(page, 'Record delivery and cash', 'Record delivered and paid', async () => {
    await dialog(page).getByLabel('Cash you collected (Rs)').fill('2000')
    await dialog(page).getByRole('checkbox').check()
  })
  await expect(page.getByRole('region', { name: 'Amount due and cash' })).toContainText('Cash collected: Rs 2,000')
  expect(statusOf(order.id)).toBe('delivered')
  expect(scalar(`SELECT method || ' ' || amount_due_paisa || ' ' || amount_collected_paisa FROM grocery_payments WHERE order_id = '${order.id}'`)).toBe('cash_on_delivery 200000 200000')
  // No second collection: the finished order refuses it.
  const revision = Number(scalar(`SELECT revision FROM grocery_orders WHERE id = '${order.id}'`))
  expect(reason(await api.call('POST', `/admin/grocery/orders/${order.id}/complete`, { revision, amountCollectedPaisa: 200_000 }))).toEqual([409, 'invalid_state_transition'])
  expect(scalar(`SELECT count(*) FROM grocery_payments WHERE order_id = '${order.id}'`)).toBe('1')
  await page.context().close()

  const mine = await signInAs(browser, buyer, `/profile/grocery/${order.id}`)
  await expect(mine.getByText('Paid in cash: Rs 2,000')).toBeVisible()
  await expect(mine.locator('body')).not.toContainText('INTERNAL')
  await expect(mine.locator('body')).not.toContainText(runner.name)
  await mine.context().close()
  await api.dispose()
})

test('cancelling: the customer before a price; the team before preparing; only a Super Admin after, with an acknowledgement', async ({ browser }) => {
  const buyer = await createUser('g4b-cancel')
  const page = await signInAs(browser, buyer, '/grocery')
  const api = await as(buyer)
  const mine = (await send(api)).body!.data
  await page.goto(`/profile/grocery/${mine.id}`)
  await page.getByRole('button', { name: 'Cancel order' }).click()
  await dialog(page).getByRole('button', { name: 'Cancel order' }).click()
  await expect(dialog(page)).toBeHidden()
  await expect.poll(() => statusOf(mine.id)).toBe('cancelled')
  await api.dispose()
  await page.context().close()

  const staff = await as(runner)
  const early = await placeAndClaim(await createUser('g4b-early'), staff)
  expect((await staff.call('POST', `/admin/grocery/orders/${early.id}/cancel`, { revision: 1, reason: 'Customer asked on the phone' })).status).toBe(200)

  const late = await placeAndClaim(await createUser('g4b-late'), staff)
  expect((await staff.call('POST', `/admin/grocery/orders/${late.id}/confirm`, { revision: 1, ...AGREEMENT })).status).toBe(200)
  expect((await staff.call('POST', `/admin/grocery/orders/${late.id}/start-preparing`, { revision: 2 })).status).toBe(200)
  const body = { revision: 3, reason: 'Customer no longer wants it' }
  const refused = await staff.call('POST', `/admin/grocery/orders/${late.id}/cancel`, { ...body, procurementAcknowledged: true })
  expect(reason(refused)).toEqual([403, 'forbidden'])
  expect(refused.body!.error!.details).toMatchObject([{ field: 'order', code: 'super_admin_required' }])
  const admin = await as(boss)
  expect((await admin.call('POST', `/admin/grocery/orders/${late.id}/cancel`, body)).status).toBe(422)
  expect((await admin.call('POST', `/admin/grocery/orders/${late.id}/cancel`, { ...body, procurementAcknowledged: true })).status).toBe(200)
  expect([statusOf(early.id), statusOf(late.id)]).toEqual(['cancelled', 'cancelled'])
  expect(scalar(`SELECT count(*) FROM grocery_payments WHERE order_id IN ('${early.id}', '${late.id}')`)).toBe('0')
  await staff.dispose()
  await admin.dispose()
})

test('a paused Moderator keeps their orders until a Super Admin releases them', async () => {
  const staff = await as(runner)
  const held = await placeAndClaim(await createUser('g4b-held'), staff)
  await staff.dispose()
  const admin = await as(boss)
  const roster = await admin.call('GET', '/admin/staff?limit=100')
  const member = (roster.body!.data as { email: string; userId: string; revision: number }[]).find((m) => m.email === runner.email)!
  expect((await admin.call('POST', `/admin/staff/moderators/${member.userId}/pause`, { revision: member.revision })).status).toBe(200)
  expect(scalar(`SELECT assigned_to FROM grocery_orders WHERE id = '${held.id}'`)).toBe(member.userId)
  expect(reason(await admin.call('POST', `/admin/grocery/orders/${held.id}/claim`))).toEqual([409, 'order_already_claimed'])
  expect((await admin.call('POST', `/admin/grocery/orders/${held.id}/release`)).status).toBe(200)
  expect(scalar(`SELECT assigned_to IS NULL FROM grocery_orders WHERE id = '${held.id}'`)).toBe('t')
  await admin.dispose()
})

/** Every key of an answer, nested; arrays by their first element. Values are not compared. */
function shape(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.length ? shape(value[0], `${path}[]`) : [`${path}[]`]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => shape(v, path ? `${path}.${k}` : k)).sort()
  return [path]
}

test('the mocked lane answers with the same fields and refusals as the real API', async ({ browser }: { browser: Browser }) => {
  const context = await newContext(browser)
  const buyer = await createUser('g4b-parity')
  const api = await as(buyer)
  const fake = new GroceryBackend()
  const viewer = { key: 'parity', emailVerified: true }
  const query = new URLSearchParams()
  const fromFake = (method: string, path: string, body?: unknown, idempotencyKey: string | null = null) =>
    fake.route(method, path, query, body, idempotencyKey, viewer)! as { status: number; body: { data?: any; meta?: unknown; error?: any } }

  expect(shape((await api.call('GET', '/grocery/availability')).body!.data), 'availability').toEqual(shape(fromFake('GET', '/grocery/availability').body.data))

  const body = { ...orderBody(), delivery: { ...orderBody().delivery, block: fake.blocks[0]! } }
  const real = await send(api, orderBody())
  const mock = fromFake('POST', '/grocery/orders', body, 'parity-key-000001')
  expect([real.status, mock.status]).toEqual([201, 201])
  expect(shape(real.body!.data), 'new order').toEqual(shape(mock.body.data))

  const realList = (await api.call('GET', '/grocery/orders')).body as { data: unknown; meta: unknown }
  const mockList = fromFake('GET', '/grocery/orders').body
  expect(shape(realList.data), 'order summaries').toEqual(shape(mockList.data))
  expect(shape(realList.meta), 'page numbers').toEqual(shape(mockList.meta))

  const refusals: [string, unknown, string][] = [
    ['block outside the list', orderBody('Eggs', 'Nowhere'), 'parity-key-000002'],
    ['the same key, another order', orderBody('Milk'), 'parity-key-000001'],
  ]
  for (const [what, order, mockKey] of refusals) {
    const realKey = key()
    if (what === 'the same key, another order') await send(api, orderBody(), realKey)
    const a = await send(api, order as never, realKey)
    const b = fromFake('POST', '/grocery/orders', what === 'block outside the list' ? order : { ...body, items: [{ name: 'Milk', unit: 'kg', quantity: '2', substitution: 'ask' }] }, mockKey)
    expect([a.status, a.body!.error!.code], what).toEqual([b.status, b.body.error.code])
    expect((a.body!.error!.details ?? []).map((d) => [d.field, d.code]), `${what}: details`).toEqual(
      (b.body.error.details ?? []).map((d: { field: string; code: string }) => [d.field, d.code]),
    )
  }

  const staffFake = new GroceryStaffBackend(fake)
  const admin = await as(boss)
  const mockStaff = staffFake.route('GET', `/admin/grocery/orders/${mock.body.data.id}`, query, undefined, {
    id: 'parity-staff', displayName: 'Parity Staff', ownerKey: 'staff', superAdmin: true, groceryScope: false, emailVerified: true,
  })! as { body: { data: unknown } }
  const realStaff = await admin.call('GET', `/admin/grocery/orders/${real.body!.data.id}`)
  expect(shape(realStaff.body!.data), 'staff order').toEqual(shape(mockStaff.body.data))

  const settingsFake = new AdminBackend(new MemoryDirectory([]))
  const realSettings = (await admin.call('GET', '/admin/grocery/settings')).body!.data as Record<string, unknown>
  const { updatedBy: _by, ...unsigned } = realSettings // the seeded version has no person; later ones do
  expect(Object.keys(unsigned).sort(), 'settings').toEqual(Object.keys(settingsFake.settings).filter((k) => k !== 'updatedBy').sort())
  await admin.dispose()
  await api.dispose()
  await context.close()
})

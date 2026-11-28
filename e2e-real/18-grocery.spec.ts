import { expect, test, type Page } from '@playwright/test'
import { ApiClient, WEB_API, createUser, expectH1, rows, scalar, signInAs, type TestUser } from './helpers/stack'

/**
 * The Grocery customer and staff journey against the REAL stack, with GROCERY-4A's session rules in
 * force (bound private reads, the staff guard, the staff revision).
 *
 * THROWAWAY DATABASE ONLY. It switches ordering ON with a made-up block and leaves orders behind,
 * which the lane's cleanup can't remove (their history is insert-only). Run it with `P12I_KEEP=1`
 * and drop the database afterwards. It refuses to run against a database whose Grocery is already on.
 */
test.describe.configure({ mode: 'serial' })
test.skip(process.env.P12I_KEEP !== '1', 'Grocery orders cannot be cleaned up: use a throwaway database and P12I_KEEP=1')

const BLOCK = 'Test Block A'
let customer: TestUser
let neighbour: TestUser
let boss: TestUser
let packer: TestUser
let packerId: string

async function asBoss(): Promise<ApiClient> {
  const api = await ApiClient.create()
  await api.login(boss.email) // a new session each time: staff changes need a sign-in under 15 minutes old
  return api
}

test.beforeAll(async () => {
  expect(scalar('SELECT count(*) FROM grocery_orders'), 'a database with orders is not a throwaway one').toBe('0')
  customer = await createUser('gr-customer')
  neighbour = await createUser('gr-neighbour')
  boss = await createUser('gr-boss', { admin: true })
  packer = await createUser('gr-packer')
  packerId = scalar(`SELECT id FROM users WHERE email = '${packer.email}'`)
})

test('it starts switched off; a Super Admin enables a test block and appoints a grocery Moderator', async ({ page }) => {
  const off = await page.request.get(`${WEB_API}/grocery/availability`)
  expect(((await off.json()) as { data: { acceptingOrders: boolean } }).data.acceptingOrders).toBe(false)
  expect(scalar('SELECT count(*) FROM grocery_settings_revisions WHERE enabled')).toBe('0') // never switched on

  const api = await asBoss()
  const settings = await api.call('GET', '/admin/grocery/settings')
  expect(settings.status).toBe(200)
  const on = await api.call('PATCH', '/admin/grocery/settings', {
    revision: settings.body!.data.revision,
    enabled: true,
    serviceableBlocks: [BLOCK],
    operatingDays: [1, 2, 3, 4, 5, 6, 7],
    opensAt: '00:00',
    closesAt: '23:59',
  })
  expect(on.status, JSON.stringify(on.body)).toBe(200)
  const appointed = await api.call('POST', '/admin/staff/moderators', { email: packer.email, scopes: ['grocery'], revision: 0 })
  expect(appointed.status, JSON.stringify(appointed.body)).toBe(201)
  expect(appointed.body!.data.revision).toBe(1)
  await api.dispose()
})

async function sendOrder(page: Page, item: string): Promise<{ id: string; reference: string }> {
  await page.goto('/grocery/new')
  await expectH1(page, 'Your grocery list')
  const form = page.getByRole('region', { name: 'Add an item' })
  await form.getByLabel('Item', { exact: true }).fill(item)
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
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/grocery/orders'),
    page.getByRole('button', { name: 'Send my order' }).click(),
  ])
  expect(response.status(), await response.text()).toBe(201)
  await expectH1(page, 'Order sent')
  return ((await response.json()) as { data: { id: string; reference: string } }).data
}

const statusOf = (id: string) => scalar(`SELECT status FROM grocery_orders WHERE id = '${id}'`)
const actions = (page: Page) => page.getByRole('region', { name: 'Actions' })
const dialog = (page: Page) => page.getByRole('dialog')

async function act(page: Page, action: string, send: string, fill?: () => Promise<void>) {
  await actions(page).getByRole('button', { name: action, exact: true }).click()
  await expect(dialog(page)).toBeVisible()
  await fill?.()
  await dialog(page).getByRole('button', { name: send, exact: true }).click()
  await expect(dialog(page)).toBeHidden()
}

let first: { id: string; reference: string }

test('a customer sends an order; only they can read it', async ({ browser }) => {
  const page = await signInAs(browser, customer, '/grocery')
  first = await sendOrder(page, 'Basmati rice')
  expect(statusOf(first.id)).toBe('submitted')
  expect(scalar('SELECT count(*) FROM grocery_orders')).toBe('1')
  await page.getByRole('link', { name: 'Track this order' }).click()
  await expectH1(page, `Order ${first.reference}`)
  const mine = await page.evaluate(async (url) => (await (await fetch(url)).json()).data.csrfToken as string, `${WEB_API}/auth/me`)

  const other = await signInAs(browser, neighbour, '/profile/grocery')
  await expectH1(other, 'My Grocery Orders')
  await expect(other.locator('body')).not.toContainText(first.reference)
  const answers = await other.evaluate(
    async ([url, token]) => {
      const plain = await fetch(url!)
      const named = await fetch(url!, { headers: { 'X-CSRF-Token': token! } })
      return [plain.status, named.status, (await named.json()).error.code as string]
    },
    [`${WEB_API}/grocery/orders/${first.id}`, mine],
  )
  expect(answers).toEqual([404, 403, 'session_mismatch'])
  await other.context().close()
  await page.context().close()
})

test('the grocery Moderator takes it through to cash on delivery, and the customer sees the result', async ({ browser }) => {
  const staff = await signInAs(browser, packer, '/admin/grocery')
  await expectH1(staff, 'Grocery orders')
  await staff.getByRole('list', { name: 'Orders' }).getByRole('link').first().click()
  await expectH1(staff, `Order ${first.reference}`)
  await actions(staff).getByRole('button', { name: 'Claim order' }).click()
  await expect(actions(staff)).toContainText('Assigned to you')
  await act(staff, 'Record agreement', 'Confirm order', async () => {
    await dialog(staff).getByLabel('Items (Rs)').fill('2100.50')
    await dialog(staff).getByLabel('Total the customer agreed to (Rs)').fill('2100.50')
    await dialog(staff).getByRole('radio', { name: 'Phone call' }).check()
    await dialog(staff).getByRole('radio', { name: /Yes, they agreed to a substitute/ }).check()
    await dialog(staff).getByLabel('Which substitutes they agreed to').fill('INTERNAL brown rice accepted')
    await dialog(staff).getByRole('checkbox').check()
  })
  await act(staff, 'Start preparing', 'Start preparing')
  await act(staff, 'Send out for delivery', 'Out for delivery')
  await act(staff, 'Record delivery and cash', 'Record delivered and paid', async () => {
    await dialog(staff).getByLabel('Cash you collected (Rs)').fill('2,100.50')
    await dialog(staff).getByRole('checkbox').check()
  })
  await expect(staff.getByRole('region', { name: 'Amount due and cash' })).toContainText('Cash collected: Rs 2,100.50')
  expect(statusOf(first.id)).toBe('delivered')
  expect(rows(`SELECT amount_collected_paisa, collected_by = '${packerId}' FROM grocery_payments`)).toEqual([['210050', 't']])
  await staff.context().close()

  const page = await signInAs(browser, customer, `/profile/grocery/${first.id}`)
  await expectH1(page, `Order ${first.reference}`)
  await expect(page.getByText('Paid in cash: Rs 2,100.50')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('INTERNAL brown rice')
  await expect(page.locator('body')).not.toContainText(packer.name)
  await page.context().close()
})

test('a Moderator whose grocery access is taken away while a screen is open changes nothing', async ({ browser }) => {
  const page = await signInAs(browser, customer, '/grocery')
  const second = await sendOrder(page, 'Eggs')
  await page.context().close()

  const staff = await signInAs(browser, packer, `/admin/grocery/${second.id}`)
  await expectH1(staff, `Order ${second.reference}`)
  await expect(actions(staff).getByRole('button', { name: 'Claim order' })).toBeVisible()

  const api = await asBoss()
  const paused = await api.call('POST', `/admin/staff/moderators/${packerId}/pause`, { revision: 1 })
  expect(paused.status, JSON.stringify(paused.body)).toBe(200)
  expect(paused.body!.data).toMatchObject({ paused: true, revision: 2 })
  await api.dispose()

  const sent: string[] = []
  staff.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/admin/grocery/')) sent.push(request.url())
  })
  await actions(staff).getByRole('button', { name: 'Claim order' }).click()
  await expect(staff.getByRole('heading', { level: 1, name: /Admin Login|Grocery staff access only|Admin access only/ })).toBeVisible()
  await expect(staff.locator('body')).not.toContainText(second.reference)
  expect(sent.length).toBeLessThanOrEqual(1) // refused once at most, never again
  expect(statusOf(second.id)).toBe('submitted')
  expect(scalar(`SELECT assigned_to IS NULL FROM grocery_orders WHERE id = '${second.id}'`)).toBe('t')
  expect(scalar(`SELECT count(*) FROM auth_sessions WHERE user_id = '${packerId}' AND revoked_at IS NULL`)).toBe('0')
  await staff.context().close()
})

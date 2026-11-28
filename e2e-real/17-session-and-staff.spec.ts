import { expect, test, type Page } from '@playwright/test'
import { ApiClient, TAG, WEB_API, createUser, expectH1, loginOn, newContext, psql, scalar, signInAs, type TestUser } from './helpers/stack'

/**
 * GROCERY-4A against the REAL stack: tabs that share one cookie, reads bound to a session
 * (AUTH_RBAC.md §38), the cookie that is never re-issued (§38.5), staff inactivity (§38.4) and the
 * staff revision (§39). "Time passing" is a staff session's own clock moved back in PostgreSQL.
 * The grocery module stays disabled: nothing here touches an order or a setting.
 *
 * It appoints and removes throwaway Moderators, so it runs on a database that can be thrown away or
 * where the lane's tagged cleanup is acceptable, like the rest of this lane.
 */
test.describe.configure({ mode: 'serial' })

let alice: TestUser
let bob: TestUser
let boss: TestUser
let other: TestUser
let helper: TestUser

test.beforeAll(async () => {
  alice = await createUser('g4a-alice')
  bob = await createUser('g4a-bob')
  boss = await createUser('g4a-boss', { admin: true })
  other = await createUser('g4a-other', { admin: true })
  helper = await createUser('g4a-helper')
})

const userId = (user: TestUser) => scalar(`SELECT id FROM users WHERE email = '${user.email}'`)
const revisionOf = (user: TestUser) => Number(scalar(`SELECT staff_revision FROM users WHERE email = '${user.email}'`))
const rolesOf = (user: TestUser) => scalar(`SELECT coalesce(string_agg(role, ','), '') FROM user_roles WHERE user_id = '${userId(user)}'`)
const scopesOf = (user: TestUser) =>
  scalar(`SELECT coalesce(string_agg(scope, ',' ORDER BY scope), '') FROM staff_scope_assignments WHERE user_id = '${userId(user)}'`)

/** The newest live session of an account. */
const sessionOf = (user: TestUser) =>
  scalar(`SELECT id FROM auth_sessions WHERE user_id = '${userId(user)}' AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`)
const lastSeen = (id: string) => scalar(`SELECT extract(epoch FROM last_seen_at)::bigint FROM auth_sessions WHERE id = '${id}'`)
/** The staff clock of one session, `minutes` back. Nothing else about the session changes. */
const idleFor = (id: string, minutes: number) =>
  psql(`UPDATE auth_sessions SET created_at = created_at - interval '${minutes} minutes', last_seen_at = last_seen_at - interval '${minutes} minutes' WHERE id = '${id}'`)

/** A fetch made by the PAGE, with its cookie, naming whatever session the test says. */
const pageGet = (page: Page, path: string, token?: string) =>
  page.evaluate(
    async ([url, named]) => {
      const response = await fetch(url!, { credentials: 'include', headers: named ? { 'X-CSRF-Token': named } : {} })
      const body = await response.json().catch(() => null)
      return { status: response.status, code: body?.error?.code ?? null, data: body?.data ?? null }
    },
    [`${WEB_API}${path}`, token ?? ''] as const,
  )

const header = (page: Page, name: string) => page.getByRole('banner').getByText(name)

test('another tab signs in as someone else: the stale tab becomes theirs and shows nothing of the first account', async ({ browser }) => {
  const first = await signInAs(browser, alice, '/profile')
  await expect(header(first, alice.name)).toBeVisible()
  const aliceToken = (await pageGet(first, '/auth/me')).data.csrfToken as string

  const second = await first.context().newPage()
  await second.goto('/profile')
  await second.getByRole('button', { name: 'Log Out' }).first().click()
  await loginOn(second, bob)

  await expect(header(first, bob.name)).toBeVisible()
  await expect(first.locator('body')).not.toContainText(alice.name)
  await expect(first.locator('body')).not.toContainText(alice.email)

  // The server's own rule: the cookie is Bob's now, so a read naming Alice's session is refused...
  expect(await pageGet(first, '/saved', aliceToken)).toMatchObject({ status: 403, code: 'session_mismatch', data: null })
  // ...which leaves Bob's session as it was, and the same read naming it (or nobody) is served.
  const bobMe = await pageGet(first, '/auth/me', aliceToken)
  expect(bobMe.status).toBe(200)
  expect(bobMe.data).toMatchObject({ email: bob.email, readBinding: true })
  expect((await pageGet(first, '/saved', bobMe.data.csrfToken)).status).toBe(200)
  expect((await pageGet(first, '/saved')).status).toBe(200)
  expect((await pageGet(first, '/categories', aliceToken)).status).toBe(200) // public: nobody is named
  await first.context().close()
})

test('a tab that missed the switch: its change is refused once, not sent again, and made by nobody', async ({ browser }) => {
  const context = await newContext(browser)
  const stale = await context.newPage()
  // A browser without the cross-tab channel, so this tab really doesn't hear of the other sign-in.
  await stale.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined })
  })
  await loginOn(stale, boss)
  await stale.goto('/admin/categories')
  const name = `${TAG} replay check`
  await stale.getByRole('button', { name: 'Add a Services category' }).click()
  await stale.getByLabel('New Services category name').fill(name)

  const second = await context.newPage()
  await second.goto('/profile')
  await second.getByRole('button', { name: 'Log Out' }).first().click()
  await loginOn(second, other) // the shared cookie is now the OTHER Super Admin's

  const sent: number[] = []
  stale.on('response', (response) => {
    const url = new URL(response.url())
    if (response.request().method() === 'POST' && url.pathname === '/api/v1/admin/categories') sent.push(response.status())
  })
  await stale.getByRole('button', { name: 'Add', exact: true }).click()
  await expect.poll(() => sent.length).toBe(1)
  await stale.waitForTimeout(1_500) // on purpose: any resend would arrive in this time
  expect(sent).toEqual([403])
  expect(scalar(`SELECT count(*) FROM categories WHERE name = '${name}'`)).toBe('0')
  await context.close()
})

test('only a sign-in sets the session cookie: reads, /auth/me and a refused read send none', async ({ browser }) => {
  const context = await newContext(browser)
  const page = await context.newPage()
  const cookiesSet: string[] = []
  page.on('response', async (response) => {
    const url = new URL(response.url())
    if (!url.pathname.startsWith('/api/v1/')) return
    const set = (await response.headersArray()).filter((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('b17_session='))
    if (set.length) cookiesSet.push(`${response.request().method()} ${url.pathname}`)
  })
  await loginOn(page, alice)
  expect(cookiesSet).toEqual(['POST /api/v1/auth/login'])
  const [cookie] = (await context.cookies()).filter((c) => c.name === 'b17_session')
  // The absolute lifetime (30 days), not the 14-day idle timeout.
  expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(29 * 86_400)

  // A session due to slide (the database says it was last used an hour ago).
  psql(`UPDATE auth_sessions SET last_seen_at = last_seen_at - interval '1 hour', expires_at = expires_at - interval '1 hour', created_at = created_at - interval '1 hour' WHERE id = '${sessionOf(alice)}'`)
  await page.goto('/profile/saved')
  await expect(header(page, alice.name)).toBeVisible()
  expect((await pageGet(page, '/saved', 'someone-elses-token')).code).toBe('session_mismatch')
  expect((await pageGet(page, '/auth/me')).status).toBe(200)
  expect(cookiesSet).toEqual(['POST /api/v1/auth/login'])
  await context.close()
})

test('staff inactivity: asking who is signed in extends nothing, and an idle staff session stays ended', async ({ browser }) => {
  const page = await signInAs(browser, boss, '/admin/staff')
  await expectH1(page, 'Staff')
  await expect(page.getByRole('list', { name: 'Staff' })).toBeVisible()
  const session = sessionOf(boss)

  idleFor(session, 119)
  const before = lastSeen(session)
  for (let i = 0; i < 3; i += 1) expect((await pageGet(page, '/auth/me')).status).toBe(200)
  expect(lastSeen(session)).toBe(before) // asking is not staff work

  idleFor(session, 2) // now past two hours
  const stale = lastSeen(session)
  expect((await pageGet(page, '/auth/me')).status).toBe(200) // still signed in as a person...
  expect(await pageGet(page, '/admin/staff')).toMatchObject({ status: 401, code: 'session_expired' }) // ...not as staff
  expect(await pageGet(page, '/admin/staff')).toMatchObject({ status: 401, code: 'session_expired' }) // and not revived by trying
  expect(lastSeen(session)).toBe(stale)

  await page.getByRole('button', { name: 'Refresh' }).click()
  await expectH1(page, 'Admin Login')
  await expect(page.locator('body')).not.toContainText(helper.email)
  await page.context().close()
})

const list = (page: Page) => page.getByRole('list', { name: 'Staff' })
const dialog = (page: Page) => page.getByRole('dialog')
const memberAction = (page: Page, name: string) => page.getByRole('group', { name: 'Change this moderator' }).getByRole('button', { name })

async function appointThroughTheForm(page: Page, user: TestUser) {
  await page.getByRole('button', { name: 'Appoint moderator' }).click()
  await dialog(page).getByLabel('Account email').fill(user.email)
  await dialog(page).getByRole('checkbox', { name: 'Food' }).check()
  await dialog(page).getByRole('button', { name: 'Review' }).click()
  await dialog(page).getByRole('checkbox', { name: /checked that this is the right/ }).check()
  await dialog(page).getByRole('button', { name: 'Appoint moderator' }).click()
}

test('staff revision: a stale decision is refused by the server and nothing is resent', async ({ browser }) => {
  const page = await signInAs(browser, boss, '/admin/staff')
  await expectH1(page, 'Staff')
  const writes: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() !== 'GET' && url.pathname.startsWith('/api/v1/admin/staff')) writes.push(`${request.method()} ${url.search}`)
  })

  await appointThroughTheForm(page, helper)
  await expect(page.getByRole('heading', { level: 2, name: helper.name })).toBeVisible()
  expect([rolesOf(helper), scopesOf(helper), revisionOf(helper)]).toEqual(['moderator', 'food', 1])

  // Another Super Admin, through the real API.
  const api = await ApiClient.create()
  await api.login(other.email)
  const target = `/admin/staff/moderators/${userId(helper)}`
  expect((await api.call('PUT', `${target}/scopes`, { scopes: ['education', 'food'], revision: 1 })).status).toBe(200)

  // Their own stale decision is refused, with the revision to look at again.
  const refused = await api.call('PUT', `${target}/scopes`, { scopes: ['directory'], revision: 1 })
  expect(refused.status).toBe(409)
  expect(refused.body!.error).toMatchObject({ code: 'conflict', details: [{ field: 'revision', code: 'staff_changed', currentRevision: 2 }] })
  expect((await api.call('DELETE', `${target}?revision=1`)).status).toBe(409)
  expect([scopesOf(helper), revisionOf(helper)]).toEqual(['education,food', 2])

  // The first admin's screen still shows what it read before: whatever they press is not applied.
  const sentBefore = writes.length
  await memberAction(page, 'Pause').click()
  await dialog(page).getByRole('button', { name: 'Pause moderator' }).click()
  await expect(page.getByText(/access changed/).first()).toBeVisible()
  expect([scopesOf(helper), revisionOf(helper)]).toEqual(['education,food', 2])
  expect(writes).toHaveLength(sentBefore) // caught by the read before sending

  // Removed meanwhile: appointing again is refused until the person has seen there is history.
  expect((await api.call('DELETE', `${target}?revision=2`)).status).toBe(204)
  await page.goto('/admin/staff')
  await expect(list(page)).toBeVisible()
  const count = writes.length
  await appointThroughTheForm(page, helper)
  await expect(dialog(page)).toContainText("Check this account's staff history first")
  expect(writes).toHaveLength(count + 1)
  expect([rolesOf(helper), revisionOf(helper)]).toEqual(['', 3])

  await dialog(page).getByRole('checkbox', { name: /checked that this is the right/ }).check()
  await dialog(page).getByRole('button', { name: 'Appoint moderator' }).click()
  await expect(dialog(page)).toHaveCount(0)
  expect(writes).toHaveLength(count + 2) // exactly one more, and only after pressing again
  expect([rolesOf(helper), scopesOf(helper), revisionOf(helper)]).toEqual(['moderator', 'food', 4])

  // Pause, resume and remove through the screens, each on the revision just read. The new
  // Moderator's own record is already open after an appointment.
  await expect(page.getByRole('heading', { level: 2, name: helper.name })).toBeVisible()
  await memberAction(page, 'Pause').click()
  await dialog(page).getByRole('button', { name: 'Pause moderator' }).click()
  await expect(page.getByText('Paused: no staff access.')).toBeVisible()
  await memberAction(page, 'Resume').click()
  await dialog(page).getByRole('checkbox', { name: 'Food' }).check()
  await dialog(page).getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByText('Moderator for: Food.')).toBeVisible()
  await memberAction(page, 'Remove moderator').click()
  await dialog(page).getByRole('checkbox', { name: /Yes, remove/ }).check()
  await dialog(page).getByRole('button', { name: 'Remove moderator' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect.poll(() => rolesOf(helper)).toBe('')
  expect(revisionOf(helper)).toBe(7)
  expect(writes.at(-1)).toBe('DELETE ?revision=6')
  expect(scalar(`SELECT count(*) FROM users WHERE email = '${helper.email}' AND status = 'active'`)).toBe('1')
  await api.dispose()
  await page.context().close()
})

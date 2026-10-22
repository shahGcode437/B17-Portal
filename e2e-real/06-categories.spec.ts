import { expect, test, type Page } from '@playwright/test'
import { ApiClient, createUser, expectH1, rows, scalar, signInAs, type TestUser } from './helpers/stack'
import { approvedProvider, publicGet, unique } from './helpers/ui'

/**
 * Journeys 22-23: Admin category management through the real UI, and the real backend's validation.
 * Every category created here is named `P12I-...` (cleanup removes only those). The seeded categories are
 * fingerprinted before and after: this lane must not change unrelated development data.
 */
test.describe.configure({ mode: 'serial' })

let admin: TestUser
let owner: TestUser
let adminPage: Page
let adminApi: ApiClient

const A = unique('Cat A')
const A2 = unique('Cat Alpha')
const B = unique('Cat B')
let aId = ''
let bId = ''
let seededFingerprint = ''

const fingerprint = () =>
  scalar(`SELECT md5(string_agg(id::text || module || name || slug || is_active::text || display_order::text || coalesce(parent_id::text,''), ',' ORDER BY id)) FROM categories WHERE name NOT LIKE 'P12I-%'`)

const publicNames = async (module: string) => ((await publicGet(`/categories?module=${module}`)).body.data as { name: string }[]).map((c) => c.name)
const sectionOf = (page: Page, module: string) => page.getByRole('button', { name: `Add a ${module} category` })

test.beforeAll(async ({ browser }) => {
  admin = await createUser('cat-admin', { admin: true })
  owner = await createUser('cat-owner', { professional: 'premium' })
  seededFingerprint = fingerprint()
  adminPage = await signInAs(browser, admin)
  adminApi = await ApiClient.create()
  await adminApi.login(admin.email)
})

test.afterAll(async () => {
  await adminPage?.context().close()
  await adminApi?.dispose()
})

test('create through the Admin UI: persisted, active, a slug is derived, visible to the public API and to the new-listing picker', async ({ browser }) => {
  await adminPage.goto('/admin/categories')
  await expectH1(adminPage, 'Categories')
  for (const name of [A, B]) {
    await sectionOf(adminPage, 'Services').click()
    await adminPage.getByLabel('New Services category name').fill(name)
    await adminPage.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(adminPage.getByText(name)).toBeVisible()
  }
  ;[aId, bId] = [A, B].map((n) => scalar(`SELECT id FROM categories WHERE name = '${n}'`))
  expect(rows(`SELECT module, is_active, slug LIKE 'p12i-%' FROM categories WHERE id = '${aId}'`)[0]).toEqual(['services', 't', 't'])
  expect(await publicNames('services')).toEqual(expect.arrayContaining([A, B]))

  // The write form's Service Category picker offers it (server taxonomy, active only).
  const page = await signInAs(browser, owner, '/provider/listings/new')
  await page.getByRole('button', { name: /Service \/ Professional/ }).click()
  expect(await page.getByLabel('Service Category').locator('option').allTextContents()).toContain(A)
  await page.context().close()
})

test('rename updates the public read and the picker; the slug does not change', async ({ browser }) => {
  const slugBefore = scalar(`SELECT slug FROM categories WHERE id = '${aId}'`)
  await adminPage.getByRole('button').filter({ hasText: A }).first().click()
  await adminPage.getByRole('textbox', { name: `Rename ${A}` }).fill(A2)
  await adminPage.keyboard.press('Enter')
  await expect(adminPage.getByText(A2)).toBeVisible()
  expect(scalar(`SELECT name FROM categories WHERE id = '${aId}'`)).toBe(A2)
  expect(scalar(`SELECT slug FROM categories WHERE id = '${aId}'`)).toBe(slugBefore) // immutable
  const names = await publicNames('services')
  expect(names).toContain(A2)
  expect(names).not.toContain(A)
  const page = await signInAs(browser, owner, '/provider/listings/new')
  await page.getByRole('button', { name: /Service \/ Professional/ }).click()
  expect(await page.getByLabel('Service Category').locator('option').allTextContents()).toContain(A2)
  await page.context().close()
})

test('deactivate hides it from the public read and new-write pickers; an existing listing keeps its category and stays valid', async ({ browser }) => {
  const slug = scalar(`SELECT slug FROM categories WHERE id = '${aId}'`)
  // A listing that already uses the category (created while it was active).
  const existing = await approvedProvider(owner, admin, 'Uses Cat Alpha', { category: slug })
  expect((await publicGet(`/listings/${existing.id}`)).status).toBe(200)

  await adminPage.locator('[data-slot="card"]').filter({ hasText: A2 }).getByRole('button', { name: 'Deactivate' }).click()
  await expect(adminPage.locator('[data-slot="card"]').filter({ hasText: A2 }).getByRole('button', { name: 'Activate' })).toBeVisible()
  expect(scalar(`SELECT is_active FROM categories WHERE id = '${aId}'`)).toBe('f')
  expect(await publicNames('services')).not.toContain(A2)
  expect(JSON.stringify((await adminApi.call('GET', '/admin/categories?module=services')).body)).toContain(A2) // Admin still sees inactive

  // The picker no longer offers it, and the API refuses it for a NEW write.
  const page = await signInAs(browser, owner, '/provider/listings/new')
  await page.getByRole('button', { name: /Service \/ Professional/ }).click()
  expect(await page.getByLabel('Service Category').locator('option').allTextContents()).not.toContain(A2)
  await page.context().close()
  const o = await ApiClient.create()
  await o.login(owner.email)
  const refused = await o.call('POST', '/listings', { kind: 'provider', name: unique('Inactive Cat'), category: slug, description: 'A new listing in an inactive category must be refused.', area: 'B-17', tags: ['x'], location: { visibility: 'area_only' } })
  expect(refused.status).toBe(422)
  expect(refused.body!.error!.details!.map((d) => d.code)).toContain('unknown_category')

  // The existing listing is untouched and still public; a plain edit of another field is still allowed.
  expect((await publicGet(`/listings/${existing.id}`)).body.data.categories.map((c: { slug: string }) => c.slug)).toContain(slug)
  const edit = await o.call('PATCH', `/listings/${existing.id}`, { revision: Number(scalar(`SELECT revision FROM listings WHERE id = '${existing.id}'`)), description: 'Edited while its category is inactive - still valid.' })
  expect(edit.status).toBe(200)
  await o.dispose()
})

test('reorder: the new order is sent as a whole group, persists after reload, and leaves every unrelated category untouched', async () => {
  // Re-activate so both of ours are siblings in the visible group, then swap them.
  await adminPage.locator('[data-slot="card"]').filter({ hasText: A2 }).getByRole('button', { name: 'Activate' }).click()
  await expect(adminPage.locator('[data-slot="card"]').filter({ hasText: A2 }).getByRole('button', { name: 'Deactivate' })).toBeVisible()
  const orderBefore = rows(`SELECT name FROM categories WHERE id IN ('${aId}','${bId}') ORDER BY display_order, name`).map((r) => r[0])
  expect(orderBefore).toEqual([A2, B].sort((x, y) => orderBefore.indexOf(x) - orderBefore.indexOf(y)))
  const [reorder] = await Promise.all([
    adminPage.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/admin/categories/reorder')),
    adminPage.locator('[data-slot="card"]').filter({ hasText: B }).getByRole('button', { name: `Move ${B} up` }).click(),
  ])
  const sent = JSON.parse(reorder.request().postData() ?? '{}') as { module: string; parentId?: string | null; orderedIds: string[] }
  expect(reorder.status(), await reorder.text()).toBe(200)
  expect(sent.module).toBe('services')
  expect(sent.orderedIds.length).toBe(Number(scalar(`SELECT count(*) FROM categories WHERE module = 'services' AND parent_id IS NULL`))) // the COMPLETE sibling group
  expect(sent.orderedIds.indexOf(bId)).toBeLessThan(sent.orderedIds.indexOf(aId))
  await expect.poll(() => rows(`SELECT name FROM categories WHERE id IN ('${aId}','${bId}') ORDER BY display_order, name`).map((r) => r[0])).toEqual([B, A2])

  await adminPage.reload()
  await expectH1(adminPage, 'Categories')
  const listed = await adminPage.locator('[data-slot="card"]').filter({ hasText: /P12I-/ }).allInnerTexts()
  expect(listed.findIndex((t) => t.includes(B))).toBeLessThan(listed.findIndex((t) => t.includes(A2)))
  const publicOrder = await publicNames('services')
  expect(publicOrder.indexOf(B)).toBeLessThan(publicOrder.indexOf(A2))
  expect(fingerprint()).toBe(seededFingerprint) // nothing else moved
})

test('validation (real backend): duplicate sibling, immutable module / slug, cross-module parent, depth, non-admin, anonymous - and the UI says why (duplicate name)', async ({ browser }) => {
  const dup = await adminApi.call('POST', '/admin/categories', { module: 'services', name: A2 })
  expect(dup.status).toBe(409)
  expect(dup.body!.error!.code).toBe('conflict')
  expect(dup.body!.error!.details!.map((d) => d.code)).toContain('duplicate')

  const moduleChange = await adminApi.call('PATCH', `/admin/categories/${aId}`, { module: 'directory' })
  expect(moduleChange.status).toBe(422)
  const slugChange = await adminApi.call('PATCH', `/admin/categories/${aId}`, { slug: 'p12i-hijack' })
  expect(slugChange.status).toBe(422)
  expect(scalar(`SELECT module FROM categories WHERE id = '${aId}'`)).toBe('services')

  // Hierarchy: a child must live in its parent's module; the tree is capped in depth.
  const directoryParent = scalar(`SELECT id FROM categories WHERE module = 'directory' AND parent_id IS NULL AND name NOT LIKE 'P12I-%' LIMIT 1`)
  const crossModule = await adminApi.call('POST', '/admin/categories', { module: 'services', name: unique('Bad Child'), parentId: directoryParent })
  expect(crossModule.status).toBe(422)
  const child = await adminApi.call('POST', '/admin/categories', { module: 'services', name: unique('Child'), parentId: aId })
  expect(child.status).toBe(201)
  const grandchild = await adminApi.call('POST', '/admin/categories', { module: 'services', name: unique('Grandchild'), parentId: child.body!.data.id })
  const tooDeep = await adminApi.call('POST', '/admin/categories', { module: 'services', name: unique('Great Grandchild'), parentId: grandchild.body?.data?.id ?? child.body!.data.id })
  expect([grandchild.status, tooDeep.status].some((s) => s === 422)).toBe(true) // the depth cap bites somewhere below the child
  expect(scalar(`SELECT count(*) FROM categories WHERE module <> 'services' AND parent_id = '${aId}'`)).toBe('0')

  // Authority: only an Admin.
  const stranger = await createUser('cat-stranger', { professional: 'free' })
  const s = await ApiClient.create()
  await s.login(stranger.email)
  expect([403, 404]).toContain((await s.call('POST', '/admin/categories', { module: 'services', name: unique('Nope') })).status)
  expect([403, 404]).toContain((await s.call('PATCH', `/admin/categories/${aId}`, { isActive: false })).status)
  await s.dispose()
  const anon = await ApiClient.create()
  expect((await anon.call('GET', '/admin/categories')).status).toBe(401)
  await anon.dispose()
  expect(scalar(`SELECT count(*) FROM categories WHERE name = '${unique('Nope')}'`)).toBe('0')

  // The UI explains a duplicate (title AND reason), it does not just say "check the form".
  await adminPage.goto('/admin/categories')
  await expectH1(adminPage, 'Categories')
  await sectionOf(adminPage, 'Services').click()
  await adminPage.getByLabel('New Services category name').fill(A2)
  await adminPage.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(adminPage.getByText(/That name is already in use: Choose a different name/)).toBeVisible()
  expect(scalar(`SELECT count(*) FROM categories WHERE name = '${A2}'`)).toBe('1')
  void browser
})

test('the seeded taxonomy was not changed by any of this', () => {
  expect(fingerprint()).toBe(seededFingerprint)
})

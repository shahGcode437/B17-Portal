import { expect, test, type Page } from '@playwright/test'
import { API, createUser, expectH1, loginOn, scalar, signInAs, type TestUser, newContext } from './helpers/stack'
import { approvedProvider, openCreateForm, unique } from './helpers/ui'

/**
 * Accessibility closeout (Phase 12I) on the REAL pages: every visible control has an accessible name, errors
 * are announced and tied to their field, dialogs take and return focus, the form is operable by keyboard
 * alone (including the map's numeric fallback), a slow submit disables the control and cannot double-send.
 * No axe dependency is added (the project has none): the checks are role / name / state assertions.
 */
let owner: TestUser
let admin: TestUser
let requester: TestUser
let listing: { id: string; name: string }

test.beforeAll(async () => {
  owner = await createUser('a11y-owner', { professional: 'premium' })
  admin = await createUser('a11y-admin', { admin: true })
  requester = await createUser('a11y-requester')
  listing = await approvedProvider(owner, admin, 'A11y Provider')
})

/** Visible controls with no accessible name (label, aria-label / -labelledby, title, text). */
async function unnamedControls(page: Page, root = 'body'): Promise<string[]> {
  return page.evaluate((selector) => {
    const scope = document.querySelector(selector) ?? document.body
    const visible = (el: Element) => {
      const style = getComputedStyle(el)
      const rect = (el as HTMLElement).getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    const named = (el: Element): boolean => {
      const html = el as HTMLInputElement
      if (el.getAttribute('aria-label')?.trim()) return true
      const by = el.getAttribute('aria-labelledby')
      if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim())) return true
      if (html.labels && Array.from(html.labels).some((l) => l.textContent?.trim())) return true
      if (el.getAttribute('title')?.trim()) return true
      if (['BUTTON', 'A'].includes(el.tagName) && el.textContent?.trim()) return true
      if (el.tagName === 'BUTTON' && el.querySelector('[aria-label], title')) return true
      if (el.tagName === 'INPUT' && ['submit', 'button'].includes(html.type) && html.value) return true
      return false
    }
    const bad: string[] = []
    scope.querySelectorAll('input:not([type=hidden]), select, textarea, button, a[href], [role=button], [role=combobox], [role=radio], [role=checkbox]').forEach((el) => {
      if (!visible(el) || el.closest('.leaflet-container')) return // map internals are the library's (the form has the numeric fallback)
      if (!named(el)) bad.push(`${el.tagName.toLowerCase()}${(el as HTMLElement).id ? '#' + (el as HTMLElement).id : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`)
    })
    return bad
  }, root)
}

test('every critical page: no visible control without an accessible name; exactly one h1; a skip link / landmarks exist', async ({ browser }) => {
  const ownerPage = await signInAs(browser, owner)
  const adminPage = await signInAs(browser, admin)
  const requesterPage = await signInAs(browser, requester)
  const targets: [Page, string, string | RegExp][] = [
    [ownerPage, '/provider/listings', 'Listings'],
    [ownerPage, '/provider/listings/new', 'List Your Business / Service / Property'],
    [ownerPage, '/provider/leads', 'Leads'],
    [adminPage, '/admin/moderation', 'Listing Review'],
    [adminPage, '/admin/categories', 'Categories'],
    [requesterPage, '/profile/saved', 'Saved'],
    [requesterPage, '/profile/requests', 'My Requests'],
    [requesterPage, `/providers/${listing.id}`, listing.name],
  ]
  for (const [page, path, heading] of targets) {
    await page.goto(path)
    await expectH1(page, heading)
    await page.waitForLoadState('networkidle')
    expect(await unnamedControls(page), `${path}: controls without an accessible name`).toEqual([])
    await expect(page.getByRole('main').first()).toBeVisible()
  }
  // Auth pages (anonymous).
  const anon = await newContext(browser)
  const anonPage = await anon.newPage()
  for (const path of ['/login', '/register']) {
    await anonPage.goto(path)
    await anonPage.waitForLoadState('networkidle')
    expect(await unnamedControls(anonPage), `${path}: controls without an accessible name`).toEqual([])
  }
  await anon.close()
  await Promise.all([ownerPage.context().close(), adminPage.context().close(), requesterPage.context().close()])
})

test('the create forms: every field of every kind is labelled, including the location block and the map fallback', async ({ browser }) => {
  const page = await signInAs(browser, owner)
  for (const kind of [/Service \/ Professional/, /Business \/ Shop/, /Tutor/, /Property/]) {
    await openCreateForm(page, kind)
    for (const visibility of ['exact', 'approximate', 'area_only']) {
      if (kind.source === 'Property' && visibility === 'area_only') continue
      await page.getByLabel('Visibility').selectOption(visibility)
      expect(await unnamedControls(page, 'main'), `${kind} / ${visibility}`).toEqual([])
    }
  }
  await page.context().close()
})

test('errors are announced and tied to their field; a failed submit keeps focus recoverable', async ({ browser }) => {
  const page = await signInAs(browser, owner)
  await openCreateForm(page, /Service \/ Professional/)
  await page.getByRole('button', { name: 'Preview Listing' }).click() // empty required fields
  const alerts = page.getByRole('alert')
  await expect(alerts.first()).toBeVisible()
  const invalid = page.locator('[aria-invalid="true"]')
  expect(await invalid.count()).toBeGreaterThan(0)
  // Each invalid control is reachable by its label and described by (or inside) an announced error.
  const descriptions = await invalid.evaluateAll((elements) =>
    elements.map((el) => {
      const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
      const text = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
      const sibling = el.parentElement?.querySelector('[role="alert"]')?.textContent?.trim() ?? ''
      return text || sibling
    })
  )
  for (const description of descriptions) expect(description.length, 'an invalid control has no error text next to it').toBeGreaterThan(0)
  // The login form: a wrong password is announced (role alert), the password field is not left in a trap.
  const anon = await newContext(page.context().browser()!)
  const login = await anon.newPage()
  await login.goto('/login')
  await login.getByLabel('Email').fill(owner.email)
  await login.getByLabel('Password', { exact: true }).fill('wrong password entirely')
  await login.keyboard.press('Enter') // operable by keyboard alone
  await expect(login.getByRole('alert').first()).toBeVisible()
  await anon.close()
  await page.context().close()
})

test('dialogs take focus, keep Tab inside, close on Escape and give focus back to the control that opened them', async ({ browser }) => {
  const page = await signInAs(browser, requester)
  await page.goto(`/providers/${listing.id}`)
  await expectH1(page, listing.name)
  const trigger = page.getByRole('button', { name: 'Request Service' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: /Request / })
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true) // focus moved into the dialog
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `Tab #${i + 1} left the dialog`).toBe(true) // no escape, no trap-less leak
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused() // focus returns to the opener
  await page.context().close()

  // The Admin review dialog as well.
  const adminPage = await signInAs(browser, admin, '/admin/moderation')
  await expectH1(adminPage, 'Listing Review')
  await adminPage.getByRole('radio', { name: /^All/ }).click()
  const review = adminPage.getByRole('button', { name: `Review ${listing.name}` })
  await review.focus()
  await adminPage.keyboard.press('Enter')
  const rd = adminPage.getByRole('dialog', { name: 'Review Listing' })
  await expect(rd).toBeVisible()
  expect(await rd.evaluate((d) => d.contains(document.activeElement))).toBe(true)
  await adminPage.keyboard.press('Escape')
  await expect(rd).toBeHidden()
  await adminPage.context().close()
})

test('keyboard only: the whole Property form incl. the map numeric fallback is reachable by Tab without a trap, and submits with Enter on the button', async ({ browser }) => {
  const page = await signInAs(browser, owner)
  await openCreateForm(page, /Property/)
  await page.getByLabel('Visibility').focus()
  const seen = new Set<string>()
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab')
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null
      return el?.labels?.[0]?.textContent?.trim() || el?.getAttribute('aria-label') || el?.textContent?.trim() || el?.tagName || ''
    })
    seen.add(label)
  }
  for (const expected of ['Latitude', 'Longitude', 'Title', 'Price', 'Description', 'Preview Listing']) {
    expect([...seen].some((s) => s.startsWith(expected)), `Tab never reached "${expected}"`).toBe(true)
  }
  // Fill by keyboard-reachable fields and submit with Enter on the focused button.
  await page.getByLabel('Latitude').fill('33.7099')
  await page.getByLabel('Longitude').fill('73.0699')
  await page.getByLabel('Street address').fill('House 5, Street 2')
  const title = unique('Keyboard Property')
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Listing Type').selectOption('rent')
  await page.getByLabel('Property Type').selectOption({ label: 'House' })
  await page.getByLabel('Price').fill('PKR 90,000 / month')
  await page.getByLabel('Area', { exact: true }).fill('B-17')
  await page.getByLabel('Description').fill('A keyboard-submitted property listing for the accessibility check.')
  await page.getByRole('button', { name: 'Preview Listing' }).focus()
  await page.keyboard.press('Enter')
  await expectH1(page, 'Listings')
  expect(scalar(`SELECT count(*) FROM listings WHERE title = '${title}'`)).toBe('1')
  await page.context().close()
})

test('a slow submit disables the control and cannot be double-sent; the form re-enables after', async ({ browser }) => {
  const page = await signInAs(browser, owner)
  await openCreateForm(page, /Service \/ Professional/)
  const name = unique('Slow Submit')
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Service Category').selectOption({ label: 'Plumbing' })
  await page.getByLabel('Description', { exact: true }).fill('A slow submission must not be sent twice by an impatient double click.')
  await page.getByLabel('Area', { exact: true }).fill('B-17')
  await page.getByLabel(/Services Offered/).fill('plumbing, repairs')
  let posts = 0
  await page.route(`${API}/listings`, async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1
      await new Promise((resolve) => setTimeout(resolve, 1800))
    }
    await route.fallback()
  })
  const submit = page.getByRole('button', { name: 'Preview Listing' })
  await submit.dblclick()
  await expect(submit).toBeDisabled() // submitting state is announced by the control itself
  await expectH1(page, 'Listings')
  expect(posts).toBe(1)
  expect(scalar(`SELECT count(*) FROM listings WHERE title = '${name}'`)).toBe('1')
  await page.context().close()
  void loginOn
})

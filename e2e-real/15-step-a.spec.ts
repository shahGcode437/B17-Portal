import { expect, test, type Page } from '@playwright/test'
import { ApiClient, createUser, expectH1, ownerCard, scalar, signInAs, type TestUser } from './helpers/stack'
import { KIND, createProvider, openCreateForm, publicGet, unique } from './helpers/ui'

/**
 * Phase 12S Step A - quota-aware listing UX, the owner preview and the dead-route cleanup, proven against the REAL
 * stack (React -> FastAPI -> PostgreSQL). The Free plan limit is the server's: these tests show the page warning a
 * person BEFORE the form, that the warning blocks nothing, and that the server still refuses and creates nothing.
 */
test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

const provider = (name: string) => ({
  kind: 'provider',
  name,
  category: 'plumbing',
  description: `${name} - plumbing repairs across B-17.`,
  area: 'B-17',
  tags: ['plumbing'],
  location: { visibility: 'area_only' },
})
const activeCount = (email: string) =>
  Number(scalar(`SELECT count(*) FROM listings WHERE owner_id = (SELECT id FROM users WHERE email = '${email}') AND status IN ('pending','approved')`))
const noticeOf = (page: Page) => page.getByRole('status').filter({ hasText: 'Active listing limit reached' })

let free: TestUser

test('a Free owner with room: no warning, New listing works, and the third listing brings the dashboard warning', async ({ browser }) => {
  free = await createUser('stepa-free', { professional: 'free' })
  const api = await ApiClient.shared(free.email)
  for (const n of ['One', 'Two']) {
    const r = await api.call('POST', '/listings', provider(unique(`StepA ${n}`)))
    expect(r.status).toBe(201)
  }
  const page = await signInAs(browser, free, '/provider/listings')
  await expectH1(page, 'Listings')
  await expect(page.getByText('2 of 3 active listings used')).toBeVisible()
  await expect(noticeOf(page)).toHaveCount(0)

  // New listing works normally, and the create page has no warning either.
  await page.getByRole('link', { name: 'New listing' }).click()
  await expectH1(page, 'List Your Business / Service / Property')
  await expect(noticeOf(page)).toHaveCount(0)
  await createProvider(page, { name: unique('StepA Three'), category: 'Plumbing' })

  // Now 3 of 3: the dashboard says so next to "New listing" and offers no upgrade.
  expect(activeCount(free.email)).toBe(3)
  await expect(page.getByText('3 of 3 active listings used')).toBeVisible()
  const notice = noticeOf(page)
  await expect(notice).toContainText('You have 3 of 3 active listings')
  await expect(notice).toContainText('Archive an active listing before creating another.')
  await expect(page.locator('body')).not.toContainText(/upgrade to premium|upgrade your plan/i)
  await expect(page.getByRole('link', { name: /upgrade|subscribe|buy/i })).toHaveCount(0)
  await page.context().close()
})

test('at 3 of 3 the create page warns before any field, the server still refuses and creates nothing, and archiving frees the slot', async ({ browser }) => {
  const page = await signInAs(browser, free, '/provider/listings')
  await expect(noticeOf(page)).toBeVisible()
  // The primary action is still a working link (it is toned down, not disabled): it opens the create page.
  const newListing = page.getByRole('link', { name: 'New listing' })
  await expect(newListing).toHaveAttribute('aria-describedby', 'listing-limit-notice')
  await newListing.click()
  await expectH1(page, 'List Your Business / Service / Property')

  // Before a kind is chosen or a field touched.
  const notice = noticeOf(page)
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Archive an active listing before creating another.')
  await expect(notice.getByRole('link', { name: 'Manage my listings' })).toHaveAttribute('href', '/provider/listings')
  await expect(notice).not.toContainText(/upgrade|premium/i)

  // The form is not blocked: submitting anyway reaches the server, which refuses (the server is the authority).
  await page.getByRole('button', { name: KIND.provider }).click()
  await expect(notice).toBeVisible()
  const name = unique('StepA Four')
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Service Category').selectOption({ label: 'Plumbing' })
  await page.getByLabel('Description', { exact: true }).fill('A fourth active listing on the Free plan must be refused by the server.')
  await page.getByLabel('Area', { exact: true }).selectOption('B-17')
  await page.getByLabel(/Services offered/).fill('plumbing, repairs')
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/listings'),
    page.getByRole('button', { name: 'Submit for Review' }).click(),
  ])
  expect(response.status()).toBe(403)
  expect(JSON.stringify(await response.json())).toContain('plan_limit_reached')
  const alert = page.getByRole('alert').filter({ hasText: 'Active listing limit reached' })
  await expect(alert).toContainText("You've reached the active listing limit for your current plan. Archive an active listing before creating another.")
  await expect(alert).not.toContainText(/upgrade|premium/i)
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name) // what was typed is kept
  expect(activeCount(free.email)).toBe(3)
  expect(scalar(`SELECT count(*) FROM listings WHERE owner_id = (SELECT id FROM users WHERE email = '${free.email}')`)).toBe('3')

  // "Manage my listings" leads to the dashboard, where archiving frees a slot and the warning goes.
  await notice.getByRole('link', { name: 'Manage my listings' }).click()
  await expectH1(page, 'Listings')
  page.once('dialog', (dialog) => void dialog.accept())
  await ownerCard(page, unique('StepA One')).getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByText('2 of 3 active listings used')).toBeVisible()
  await expect(noticeOf(page)).toHaveCount(0)
  expect(activeCount(free.email)).toBe(2)
  await page.getByRole('link', { name: 'New listing' }).click()
  await expectH1(page, 'List Your Business / Service / Property')
  await expect(noticeOf(page)).toHaveCount(0)
  await page.context().close()
})

test('stale counts: the page sees room, the server is already full, and the refusal is still explained', async ({ browser }) => {
  const stale = await createUser('stepa-stale', { professional: 'free' })
  const api = await ApiClient.shared(stale.email)
  for (const n of ['A', 'B']) expect((await api.call('POST', '/listings', provider(unique(`StepA Stale ${n}`)))).status).toBe(201)
  const page = await signInAs(browser, stale)
  await openCreateForm(page, KIND.provider)
  await expect(noticeOf(page)).toHaveCount(0) // the browser knows of 2 active listings

  // Another tab (here: the API) fills the third slot.
  expect((await api.call('POST', '/listings', provider(unique('StepA Stale C')))).status).toBe(201)

  await page.getByLabel('Name', { exact: true }).fill(unique('StepA Stale D'))
  await page.getByLabel('Service Category').selectOption({ label: 'Plumbing' })
  await page.getByLabel('Description', { exact: true }).fill('The page believed there was room; the server knows better and says so.')
  await page.getByLabel('Area', { exact: true }).selectOption('B-17')
  await page.getByLabel(/Services offered/).fill('plumbing, repairs')
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/listings'),
    page.getByRole('button', { name: 'Submit for Review' }).click(),
  ])
  expect(response.status()).toBe(403)
  await expect(page.getByRole('alert').filter({ hasText: 'Active listing limit reached' })).toContainText('Archive an active listing before creating another.')
  expect(activeCount(stale.email)).toBe(3)
  await page.context().close()
})

test('a Premium owner is never warned', async ({ browser }) => {
  const premium = await createUser('stepa-premium', { professional: 'premium' })
  const api = await ApiClient.shared(premium.email)
  for (const n of ['A', 'B', 'C', 'D']) expect((await api.call('POST', '/listings', provider(unique(`StepA Premium ${n}`)))).status).toBe(201)
  const page = await signInAs(browser, premium, '/provider/listings')
  await expectH1(page, 'Listings')
  await expect(ownerCard(page, unique('StepA Premium A'))).toBeVisible()
  await expect(noticeOf(page)).toHaveCount(0)
  await expect(page.getByText(/active listings used/)).toHaveCount(0)
  await page.getByRole('link', { name: 'New listing' }).click()
  await expectH1(page, 'List Your Business / Service / Property')
  await expect(noticeOf(page)).toHaveCount(0)
  await page.context().close()
})

test('the owner preview of a property shows its facts and placeholder, nothing public, nothing invented', async ({ browser }) => {
  const owner = await createUser('stepa-property', { professional: 'free' })
  const api = await ApiClient.shared(owner.email)
  const title = unique('StepA Corner House')
  const address = 'House 12, Street 4, Block C'
  const created = await api.call('POST', '/listings', {
    kind: 'property',
    title,
    listingType: 'rent',
    propertyType: 'house',
    price: 'PKR 85,000 / month',
    bedrooms: 3,
    furnished: 'Semi-Furnished',
    description: `${title} - a bright, well-kept home in a quiet B-17 block.`,
    area: 'B-17',
    location: { visibility: 'exact', block: 'C', address, latitude: 33.71, longitude: 73.1 },
  })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  const id = created.body!.data.id as string

  const page = await signInAs(browser, owner, '/provider/listings')
  await ownerCard(page, title).getByRole('button', { name: 'View' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
  await expect(dialog.getByText('Pending Review')).toBeVisible()
  // The status badge does not run under the dialog's close button.
  const badge = await dialog.getByText('Pending Review').boundingBox()
  const close = await dialog.getByRole('button', { name: 'Close' }).boundingBox()
  expect(badge!.x + badge!.width, 'badge vs close button').toBeLessThanOrEqual(close!.x)
  await expect(dialog.getByText('Property · House · For Rent')).toBeVisible()
  const facts = dialog.getByRole('region', { name: 'Listing details' })
  await expect(facts).toContainText(/Listing\s*For Rent/)
  await expect(facts).toContainText(/Property type\s*House/)
  await expect(facts).toContainText(/Price\s*PKR 85,000 \/ month/)
  await expect(facts).toContainText(/Bedrooms\s*3/)
  await expect(facts).toContainText(/Furnishing\s*Semi-Furnished/)
  // No photo can be added yet, so the placeholder says there is none (and no image element exists).
  await expect(dialog.getByRole('img', { name: `No photo available for ${title}` })).toBeVisible()
  await expect(dialog.locator('img')).toHaveCount(0)
  // The facts hold nothing private; the owner's OWN location block (their address) is where that lives.
  await expect(facts).not.toContainText(address)
  await expect(facts).not.toContainText('33.71')
  await expect(dialog.getByRole('region', { name: 'Location' })).toContainText(address)
  expect(await dialog.innerHTML()).not.toMatch(/blob:|data:image/)
  // Moderation is not bypassed: the listing is pending, so it has no public page and no public link.
  await expect(dialog.getByRole('button', { name: 'View Public Listing' })).toHaveCount(0)
  expect((await publicGet(`/listings/${id}`)).status).toBe(404)
  await page.context().close()
})

test('/provider/listings/pending is a plain 404 and no page links to it', async ({ browser }) => {
  const page = await signInAs(browser, free)
  await page.goto('/provider/listings/pending')
  await expectH1(page, 'Page Not Found')
  await expect(page).toHaveTitle(/Page Not Found/)
  for (const path of ['/', '/provider', '/provider/listings', '/provider/listings/new', '/provider/leads', '/provider/profile', '/provider/analytics', '/provider/upgrade']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
    expect(hrefs.filter((href) => href.includes('listings/pending')), path).toEqual([])
  }
  await page.context().close()
})

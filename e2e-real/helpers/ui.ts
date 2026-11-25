import { expect, type Page } from '@playwright/test'
import { API, ApiClient, TAG, expectH1, type TestUser } from './stack'

/** UI drivers shared by the real-stack specs. Semantic locators only (role / label / text). */

/**
 * The listing's own contact number (Listing Contact v1): required on every owner create form, typed
 * in the national form a person would use so the lane also proves the API normalises it to E.164.
 */
export const CONTACT_PHONE = '0300 1234567'
export const CONTACT_PHONE_E164 = '+923001234567'
export const WHATSAPP_PHONE = '0321 7654321'
export const WHATSAPP_PHONE_E164 = '+923217654321'

/** Fills the shared contact section; `whatsapp` adds the optional second number. */
export async function fillContact(page: Page, whatsapp?: string) {
  await page.getByLabel('Contact Number').fill(CONTACT_PHONE)
  if (whatsapp) await page.getByLabel('WhatsApp Number (optional)').fill(whatsapp)
}

export type KindButton = RegExp
/**
 * The kinds an owner lists on the create page. A Service / Professional ("provider") listing is portal-managed and has
 * no owner (RBAC-D): it is authored by staff through `POST /admin/providers` (`createPortalProvider` below), never on
 * this form, so there is deliberately no `provider` entry. The Tutor is the lane's generic OWNED listing.
 */
export const KIND = {
  business: /Business \/ Shop/,
  tutor: /^Tutor/,
  property: /^Property/,
} as const

export interface LocationInput {
  visibility: 'exact' | 'approximate' | 'area_only'
  lat?: number
  lng?: number
  address?: string
  landmark?: string
  block?: string
}

export async function openCreateForm(page: Page, kind: KindButton) {
  await page.goto('/provider/listings/new')
  await expectH1(page, 'List a Business, Tutor or Property')
  await page.getByRole('button', { name: kind }).click()
}

/** Visibility first (it clears fields the new mode forbids), then the rest; the point via the numeric fallback. */
export async function setLocation(page: Page, o: LocationInput) {
  await page.getByLabel('Visibility').selectOption(o.visibility)
  if (o.block !== undefined) await page.getByLabel('Block (optional)').fill(o.block)
  if (o.address !== undefined) await page.getByLabel('Street address').fill(o.address)
  if (o.landmark !== undefined) await page.getByLabel('Landmark (optional)').fill(o.landmark)
  if (o.lat !== undefined && o.lng !== undefined) {
    await page.getByLabel('Latitude').fill(String(o.lat))
    await page.getByLabel('Longitude').fill(String(o.lng))
    await page.getByLabel('Longitude').blur()
  }
}

/** Clicks Submit for Review, waits for the real `POST /listings` and returns the new id (201 required). */
export async function submitCreate(page: Page): Promise<string> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/listings'),
    page.getByRole('button', { name: 'Submit for Review' }).click(),
  ])
  expect(response.status(), await response.text()).toBe(201)
  const id = ((await response.json()) as { data: { id: string } }).data.id
  await expectH1(page, 'Listings')
  return id
}

export interface TutorFields {
  name: string
  subject: string
  grade?: string
  description?: string
  tags?: string
  /** The optional WhatsApp number (the contact number is always filled). */
  whatsapp?: string
  location?: LocationInput
}

/** Fills the Tutor create form (kind already chosen) without submitting: the lane's generic owned listing. */
export async function fillTutorForm(page: Page, f: TutorFields) {
  await page.getByLabel('Grade / level you teach').fill(f.grade ?? 'Grade 9')
  await page.getByLabel('Name', { exact: true }).fill(f.name)
  await page.getByLabel('Subject').selectOption({ label: f.subject })
  await page.getByLabel('Description', { exact: true }).fill(f.description ?? `${f.name} - physics and chemistry for matric and O-level.`)
  await page.getByLabel('Area', { exact: true }).selectOption('B-17')
  await page.getByLabel(/Topics you teach/).fill(f.tags ?? 'physics, chemistry')
  await fillContact(page, f.whatsapp)
  if (f.location) await setLocation(page, f.location)
}

export async function createGeneralBusiness(page: Page, f: { name: string; category: string; location?: LocationInput }): Promise<string> {
  await openCreateForm(page, KIND.business)
  await page.getByLabel('Business Name').fill(f.name)
  await page.getByLabel('Category', { exact: true }).selectOption({ label: f.category })
  await page.getByLabel('Description', { exact: true }).fill(`${f.name} - books, copies and office supplies for B-17.`)
  await page.getByLabel('Area', { exact: true }).selectOption('B-17')
  await page.getByLabel('Tags (optional)').fill('books, copies')
  await fillContact(page)
  if (f.location) await setLocation(page, f.location)
  return submitCreate(page)
}

export async function createFood(page: Page, f: { name: string; location?: LocationInput }): Promise<string> {
  await openCreateForm(page, KIND.business)
  await page.getByRole('radio', { name: /Food & Dining/ }).click()
  await page.getByLabel('Business Name').fill(f.name)
  await page.getByLabel('Description', { exact: true }).fill(`${f.name} - fresh bread, cakes and savouries baked daily in B-17.`)
  await page.getByLabel('Area', { exact: true }).selectOption('B-17')
  await page.getByLabel(/Dishes \/ Search Tags/).fill('cakes, bread')
  await fillContact(page, WHATSAPP_PHONE)  // a restaurant is the WhatsApp case
  await page.getByRole('checkbox', { name: 'Bakeries' }).check()
  await page.getByRole('checkbox', { name: 'Takeaway' }).check()
  if (f.location) await setLocation(page, f.location)
  return submitCreate(page)
}

export async function createTutor(page: Page, f: TutorFields): Promise<string> {
  await openCreateForm(page, KIND.tutor)
  await fillTutorForm(page, f)
  return submitCreate(page)
}

export async function createProperty(
  page: Page,
  f: { title: string; type: string; listingType?: 'rent' | 'sale'; price?: string; location: LocationInput }
): Promise<string> {
  await openCreateForm(page, KIND.property)
  await setLocation(page, f.location)
  await page.getByLabel('Title').fill(f.title)
  await page.getByLabel('Listing Type').selectOption(f.listingType ?? 'rent')
  await page.getByLabel('Property Type').selectOption({ label: f.type })
  await page.getByLabel('Price').fill(f.price ?? 'PKR 65,000 / month')
  await page.getByLabel('Area', { exact: true }).selectOption('B-17')
  await page.getByLabel('Description').fill(`${f.title} - a bright, well-kept home in a quiet B-17 block.`)
  await fillContact(page)
  return submitCreate(page)
}

// -- Admin / API shortcuts (set-up of state the UI under test then acts on) -------------------------

export const unique = (what: string) => `${TAG} ${what}`

/** Creates an APPROVED OWNED listing (a Tutor) through the API (owner + admin sessions) — set-up for journeys whose subject is something else. */
export async function approvedTutor(owner: TestUser, admin: TestUser, what: string, extra: Record<string, unknown> = {}): Promise<{ id: string; name: string; revision: number }> {
  const name = unique(what)
  const o = await ApiClient.shared(owner.email)
  const a = await ApiClient.shared(admin.email)
  try {
    const created = await o.call('POST', '/listings', {
      kind: 'tutor',
      name,
      category: 'physics',
      grade: 'Grade 9',
      contactPhone: CONTACT_PHONE,
      description: `${name} - physics lessons and past papers across B-17.`,
      area: 'B-17',
      tags: ['physics', 'lessons'],
      location: { visibility: 'area_only', block: 'C' },
      ...extra,
    })
    if (created.status !== 201) throw new Error(`create: ${created.status} ${JSON.stringify(created.body)}`)
    const approved = await a.call('POST', `/admin/listings/${created.body!.data.id}/approve`, { revision: created.body!.data.revision })
    if (approved.status !== 200) throw new Error(`approve: ${approved.status} ${JSON.stringify(approved.body)}`)
    return { id: created.body!.data.id as string, name, revision: approved.body!.data.revision as number }
  } finally {
    await o.dispose()
    await a.dispose()
  }
}

/**
 * A Service / Professional is PORTAL-MANAGED (RBAC-D): it has no owner and is authored by STAFF. The real staff API
 * creates it (`POST /admin/providers`, pending, revision 1) with a Super Admin session — no database shortcut, no
 * owner path (the owner API refuses a Provider for everyone). Its name carries the lane's `P12I` tag, which is how
 * `cleanup()` finds it (an ownerless row cannot be found through an owner).
 */
export async function createPortalProvider(admin: TestUser, what: string, extra: Record<string, unknown> = {}): Promise<{ id: string; name: string; revision: number }> {
  const name = unique(what)
  const a = await ApiClient.shared(admin.email)
  try {
    const created = await a.call('POST', '/admin/providers', {
      name,
      category: 'plumbing',
      description: `${name} - plumbing repairs and fittings across B-17.`,
      area: 'B-17',
      tags: ['plumbing', 'repairs'],
      location: { visibility: 'area_only', block: 'C' },
      ...extra,
    })
    if (created.status !== 201) throw new Error(`create provider: ${created.status} ${JSON.stringify(created.body)}`)
    return { id: created.body!.data.id as string, name, revision: created.body!.data.revision as number }
  } finally {
    await a.dispose()
  }
}

/** A staff-authored Provider that is already APPROVED (the request target of the Saved / request journeys). */
export async function approvedPortalProvider(admin: TestUser, what: string, extra: Record<string, unknown> = {}): Promise<{ id: string; name: string; revision: number }> {
  const created = await createPortalProvider(admin, what, extra)
  const a = await ApiClient.shared(admin.email)
  try {
    const approved = await a.call('POST', `/admin/listings/${created.id}/approve`, { revision: created.revision })
    if (approved.status !== 200) throw new Error(`approve provider: ${approved.status} ${JSON.stringify(approved.body)}`)
    return { ...created, revision: approved.body!.data.revision as number }
  } finally {
    await a.dispose()
  }
}

/**
 * The PORTAL handles a Service Request (RBAC-D): a Super Admin (or a Services Moderator) acts through the staff request
 * API. There is no provider inbox and no staff screen yet, so the lane drives the real endpoint. Returns the HTTP status.
 */
export async function staffAct(admin: TestUser, requestId: string, action: 'accept' | 'start' | 'complete' | 'cancel'): Promise<number> {
  const a = await ApiClient.shared(admin.email)
  try {
    return (await a.call('POST', `/admin/requests/${requestId}/${action}`, {})).status
  } finally {
    await a.dispose()
  }
}

/** Opens the moderation queue (all statuses) and the review dialog of `name` (real UI). */
export async function openReviewInUi(admin: Page, name: string) {
  await admin.goto('/admin/moderation')
  await expectH1(admin, 'Listing Review')
  await admin.getByRole('radio', { name: /^All/ }).click()
  await admin.getByRole('button', { name: `Review ${name}` }).click()
  const dialog = admin.getByRole('dialog', { name: 'Review Listing' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** The signed-in admin reviews `name` in the moderation queue and approves it (real UI). */
export async function approveInUi(admin: Page, name: string) {
  const dialog = await openReviewInUi(admin, name)
  await expect(dialog).toContainText('Pending Review')
  await dialog.getByRole('button', { name: /^Approve$/ }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

export async function rejectInUi(admin: Page, name: string, reason: string) {
  const dialog = await openReviewInUi(admin, name)
  await dialog.getByRole('button', { name: /^Reject$/ }).click()
  await dialog.getByLabel(/Rejection reason/).fill(reason)
  await dialog.getByRole('button', { name: /Confirm Rejection/ }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

/** Approved -> rejected (takedown) with a reason. */
export async function takedownInUi(admin: Page, name: string, reason: string) {
  const dialog = await openReviewInUi(admin, name)
  await dialog.getByRole('button', { name: /^Take down$/ }).click()
  await dialog.getByLabel(/Take down reason/).fill(reason)
  await dialog.getByRole('button', { name: /Confirm takedown/ }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

/** Public (anonymous) reads of the real API. */
export async function publicGet(path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${API}${path}`)
  return { status: response.status, body: await response.json().catch(() => null) }
}

export async function searchHits(q: string): Promise<{ id: string; kind: string; item: Record<string, any> }[]> {
  const { body } = await publicGet(`/search?q=${encodeURIComponent(q)}&limit=50`)
  return ((body?.data ?? []) as { kind: string; item: Record<string, any> }[]).map((hit) => ({ id: hit.item.id as string, kind: hit.kind, item: hit.item }))
}

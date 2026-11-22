import { expect, test, type Page } from '@playwright/test'
import { ApiClient, createUser, expectH1, ownerCard, rows, scalar, signInAs, type TestUser, newContext } from './helpers/stack'
import { approveInUi, approvedPortalProvider, createTutor, publicGet, rejectInUi, searchHits, staffAct, unique } from './helpers/ui'

/**
 * PRESENTATION REGRESSION - REAL STACK (Phase 12I acceptance criterion).
 *
 * One continuous story, driven through the real React UI against FastAPI and PostgreSQL, with every
 * actor in their own browser (owner, admin, public visitor, saver, requester). After each hop the test
 * reads PostgreSQL directly, and the state is re-read after a reload: nothing here is mocked and nothing
 * is held in browser storage.
 *
 *  1 login  2 Professional capability  3 create  4 owner sees pending  5 admin sees pending
 *  6 approve  7 public sees it  8 material edit  9 pending  10 admin rejects with a reason
 *  11 owner sees the reason  12 owner changes + resubmits  13 pending  14 admin approves again
 *  15 public sees the update  16 another user saves it  17 request created (for a portal Provider)
 *  18 STAFF accept / start / complete  19 requester sees Completed  20 owner archives  21 public no
 *  longer sees it  22 reloads preserve every state
 *
 * The owned listing of the story is a Tutor. A Service / Professional is portal-managed and ownerless (RBAC-D): it
 * is the target of the REQUEST half of the story (created through the real staff API), and the portal side of that
 * request is handled by staff through the staff request API (there is no provider inbox and no staff screen yet).
 */
test.setTimeout(420_000)

const NAME = unique('Presentation Tutor')
const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const row = (id: string) => rows(`SELECT status, revision FROM listings WHERE id = '${id}'`)[0]!
const story = (id: string) => scalar(`SELECT string_agg(action, ',' ORDER BY created_at, revision) FROM listing_status_history WHERE listing_id = '${id}'`)

test('login -> Professional -> create -> approve -> edit -> reject -> resubmit -> approve -> Saved -> request lifecycle -> archive, on the real stack', async ({ browser }) => {
  const owner = await createUser('pres-owner') // a verified RESIDENT: no professional profile yet
  const admin = await createUser('pres-admin', { admin: true })
  const saver = await createUser('pres-saver')
  const requester = await createUser('pres-requester')
  let id = ''

  const pages: Page[] = []
  const open = async (user: TestUser, landing?: string) => {
    const p = await signInAs(browser, user, landing)
    pages.push(p)
    return p
  }
  const ownerPage = await open(owner)
  const adminPage = await open(admin)

  await test.step('1-2. login, then the Professional capability is created through the UI and survives a reload', async () => {
    await ownerPage.goto('/provider/listings/new')
    await expect(ownerPage.getByText('Professional profile needed')).toBeVisible()
    await ownerPage.getByRole('button', { name: 'Create a professional profile' }).click()
    await expectH1(ownerPage, 'List a Business, Tutor or Property')
    await ownerPage.reload()
    await expectH1(ownerPage, 'List a Business, Tutor or Property')
    expect(scalar(`SELECT plan_code FROM professional_profiles WHERE user_id = (SELECT id FROM users WHERE email = '${owner.email}')`)).toBe('free')
  })

  await test.step('3-4. create a Tutor listing; the owner sees it Pending Review (revision 1) after a reload', async () => {
    id = await createTutor(ownerPage, {
      name: NAME,
      subject: 'Physics',
      grade: 'Grade 9',
      description: 'Physics lessons for matric and A-level students in B-17 homes and study centres.',
      location: { visibility: 'exact', lat: 33.7011, lng: 73.0511, address: 'Shop 4, Demo Plaza', block: 'C' },
    })
    await ownerPage.reload()
    await expect(ownerCard(ownerPage, NAME)).toContainText('Pending Review')
    expect(row(id)).toEqual(['pending', '1'])
    expect((await publicGet(`/listings/${id}`)).status).toBe(404) // not public yet
  })

  await test.step('5-6. the Admin sees it pending in the queue and approves it', async () => {
    await adminPage.goto('/admin/moderation')
    await expect(adminPage.getByRole('button', { name: `Review ${NAME}` })).toBeVisible()
    await approveInUi(adminPage, NAME)
    expect(row(id)).toEqual(['approved', '1']) // a decision never bumps the revision
  })

  await test.step('7. the public sees the approved listing (search, detail, and the visitor page)', async () => {
    expect((await searchHits(NAME)).some((h) => h.id === id)).toBe(true)
    const visitorContext = await newContext(browser)
    const visitor = await visitorContext.newPage()
    await visitor.goto(`http://127.0.0.1:5173/tutors/${id}`)
    await expectH1(visitor, NAME)
    await expect(visitor.getByText('Shop 4, Demo Plaza').first()).toBeVisible()
    await visitorContext.close()
    await ownerPage.goto('/provider/listings')
    await expect(ownerCard(ownerPage, NAME)).toContainText('Approved')
  })

  await test.step('8-9. a material edit sends the listing back to Pending (revision 2); it leaves public view', async () => {
    await ownerCard(ownerPage, NAME).getByRole('button', { name: 'Edit' }).click()
    await expectH1(ownerPage, 'Edit Listing')
    await ownerPage.getByLabel('Description', { exact: true }).fill('Physics lessons for matric and A-level students - now with small-group past-paper sessions.')
    await ownerPage.getByRole('button', { name: 'Save Changes' }).click()
    await expect(ownerPage.getByText('Changes submitted for review')).toBeVisible()
    await ownerPage.reload()
    await expect(ownerCard(ownerPage, NAME)).toContainText('Pending Review')
    await expect(ownerCard(ownerPage, NAME)).toContainText('revision 2')
    expect(row(id)).toEqual(['pending', '2'])
    expect((await publicGet(`/listings/${id}`)).status).toBe(404)
  })

  await test.step('10-11. the Admin rejects with a reason; the owner sees that reason', async () => {
    await rejectInUi(adminPage, NAME, 'Please add a short syllabus outline for each level you teach.')
    await ownerPage.reload()
    await expect(ownerCard(ownerPage, NAME)).toContainText('Rejected')
    await expect(ownerCard(ownerPage, NAME)).toContainText('Please add a short syllabus outline for each level you teach.')
  })

  await test.step('12-13. the owner changes a field and resubmits: Pending again (revision 3), the reason is gone', async () => {
    await ownerCard(ownerPage, NAME).getByRole('button', { name: 'Edit' }).click()
    await expectH1(ownerPage, 'Edit Listing')
    await ownerPage.getByLabel('Description', { exact: true }).fill('Physics lessons for matric and A-level students. A photo gallery of past classes is available on request.')
    await ownerPage.getByRole('button', { name: 'Resubmit for Review' }).click()
    await expectH1(ownerPage, 'Listings')
    await ownerPage.reload()
    await expect(ownerCard(ownerPage, NAME)).toContainText('Pending Review')
    await expect(ownerCard(ownerPage, NAME)).toContainText('revision 3')
    await expect(ownerCard(ownerPage, NAME)).not.toContainText('short syllabus outline')
    expect(row(id)).toEqual(['pending', '3'])
  })

  await test.step('14-15. the Admin approves again; the public sees the UPDATED listing', async () => {
    await approveInUi(adminPage, NAME)
    expect(row(id)).toEqual(['approved', '3'])
    const detail = await publicGet(`/listings/${id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.bio).toContain('photo gallery') // a Tutor's public text is `bio`
  })

  await test.step('16. another user saves it; the Saved page shows it after a reload', async () => {
    const saverPage = await open(saver)
    await saverPage.goto(`/tutors/${id}`)
    await expectH1(saverPage, NAME)
    await saverPage.getByRole('button', { name: `Save ${NAME}` }).click()
    await expect(saverPage.getByRole('button', { name: `Remove ${NAME} from saved` })).toHaveAttribute('aria-pressed', 'true')
    await saverPage.goto('/profile/saved')
    await saverPage.reload()
    await expect(saverPage.getByText(NAME).first()).toBeVisible()
    expect(scalar(`SELECT count(*) FROM saved_items WHERE listing_id = '${id}'`)).toBe('1')
  })

  let requestId = ''
  let provider!: { id: string; name: string; revision: number }
  await test.step('17. a verified requester sends a service request for a portal Provider through the dialog', async () => {
    provider = await approvedPortalProvider(admin, 'Presentation Provider') // staff-authored, no owner
    const requesterPage = await open(requester)
    await requesterPage.goto(`/providers/${provider.id}`)
    await requesterPage.getByRole('button', { name: 'Request Service' }).click()
    const dialog = requesterPage.getByRole('dialog', { name: /Request / })
    await dialog.getByLabel('What do you need?').fill('Please quote a kitchen plumbing fix for a 10 marla house.')
    await dialog.getByLabel('Area / Location').fill('B-17, Block C')
    await dialog.getByLabel('Preferred Date').fill(tomorrow())
    const [response] = await Promise.all([
      requesterPage.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/requests')),
      dialog.getByRole('button', { name: /Submit Request/ }).click(),
    ])
    expect(response.status()).toBe(201)
    requestId = (await response.json()).data.id
    await expect(dialog.getByText('Request sent')).toBeVisible()
    expect(scalar(`SELECT status FROM service_requests WHERE id = '${requestId}'`)).toBe('submitted')
  })

  await test.step('18. STAFF accept, start and complete it through the staff request API (the portal is the provider)', async () => {
    for (const [action, status] of [['accept', 'accepted'], ['start', 'in-progress'], ['complete', 'completed']] as const) {
      expect(await staffAct(admin, requestId, action), action).toBe(200)
      expect(scalar(`SELECT status FROM service_requests WHERE id = '${requestId}'`)).toBe(status)
    }
  })

  await test.step('19. the requester sees Completed after a reload', async () => {
    const requesterPage = pages[pages.length - 1]!
    await requesterPage.goto('/profile/requests')
    await requesterPage.reload()
    await expectH1(requesterPage, 'My Requests')
    await expect(requesterPage.getByRole('button').filter({ hasText: provider.name }).first()).toContainText('Completed')
  })

  await test.step('20-21. the owner archives the Tutor, staff archive the Provider; the public no longer sees them; the rows are kept; the request survives', async () => {
    ownerPage.once('dialog', (d) => void d.accept())
    await ownerPage.goto('/provider/listings')
    await ownerCard(ownerPage, NAME).getByRole('button', { name: 'Archive' }).click()
    await expect(ownerCard(ownerPage, NAME)).toContainText('Archived', { timeout: 15_000 })
    expect(row(id)[0]).toBe('archived')
    expect(scalar(`SELECT count(*) FROM listings WHERE id = '${id}'`)).toBe('1')
    expect((await publicGet(`/listings/${id}`)).status).toBe(404)
    expect((await searchHits(NAME)).some((h) => h.id === id)).toBe(false)
    // The Provider has no owner: STAFF archive it through the staff API, and the completed request outlives it.
    const a = await ApiClient.shared(admin.email)
    const archived = await a.call('POST', `/admin/providers/${provider.id}/archive`, { revision: Number(scalar(`SELECT revision FROM listings WHERE id = '${provider.id}'`)) })
    expect(archived.status, JSON.stringify(archived.body)).toBe(200)
    expect(row(provider.id)[0]).toBe('archived')
    expect((await publicGet(`/listings/${provider.id}`)).status).toBe(404)
    expect(scalar(`SELECT status FROM service_requests WHERE id = '${requestId}'`)).toBe('completed') // the request outlives the listing
  })

  await test.step('22. reload everything: every state is the server’s', async () => {
    await ownerPage.reload()
    await expect(ownerCard(ownerPage, NAME)).toContainText('Archived')
    const saverPage = pages[pages.length - 2]!
    await saverPage.goto('/profile/saved')
    await expectH1(saverPage, 'Saved')
    await expect(saverPage.getByText(NAME)).toHaveCount(0) // an archived listing is not shown
    const requesterPage = pages[pages.length - 1]!
    await requesterPage.goto('/profile/requests')
    await expect(requesterPage.getByRole('button').filter({ hasText: provider.name }).first()).toContainText('Completed')
    // The audit trail, in time order, is exactly the story that was told.
    expect(story(id)).toBe('submitted,approved,resubmitted,rejected,resubmitted,approved,archived')
    expect(rows(`SELECT COALESCE(from_status,'-'), to_status FROM service_request_status_history WHERE request_id = '${requestId}' ORDER BY created_at, id`).map((r) => r.join('>'))).toEqual(['->submitted', 'submitted>accepted', 'accepted>in-progress', 'in-progress>completed'])
    // Browser storage never held any of it.
    for (const p of pages) {
      const keys = await p.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)))
      for (const key of keys) expect(key).not.toMatch(/listing|saved|request|plan|professional|resident|token/i)
    }
  })

  for (const p of pages) await p.context().close()
})

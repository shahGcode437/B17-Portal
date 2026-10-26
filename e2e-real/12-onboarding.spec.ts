import { expect, test } from '@playwright/test'
import { PASSWORD, TAG, devVerify, emailFor, expectH1, newContext, ownerCard, rows, scalar } from './helpers/stack'
import { createProvider } from './helpers/ui'

/**
 * Phase 12S: a FRESH person, start to finish, with nothing pre-verified and no test shortcut: register ->
 * told to verify -> gets the link from the development helper -> verified (still signed in) -> creates the
 * Professional profile -> creates a Provider listing -> sees it Pending after a reload.
 *
 * The browser is opened at `localhost:5173` on purpose: that is the URL `npm run dev` invites a developer
 * to use, and the one that used to break register / login.
 */
test.describe.configure({ mode: 'serial' })

const ORIGIN = 'http://localhost:5173'
const email = emailFor('onboarding')
const name = `${TAG} Fresh Person`
const listing = `${TAG} Fresh Plumbing`

test('a fresh user is told to verify, and the Professional area refuses them until they do', async ({ browser }) => {
  const context = await newContext(browser, { baseURL: ORIGIN })
  const page = await context.newPage()

  await page.goto('/register')
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create Account', exact: true }).click()
  await expect(page.getByRole('banner').getByText(name)).toBeVisible()
  expect(scalar(`SELECT email_verified_at IS NULL FROM users WHERE email = '${email}'`)).toBe('t')

  // The Professional gate lets them try - and the server (not the UI) refuses, with a clear message.
  await page.getByRole('banner').getByRole('link', { name: /List Your Business/ }).first().click()
  await expect(page.getByText('Professional profile needed')).toBeVisible()
  await page.getByRole('button', { name: 'Create a professional profile' }).click()
  await expect(page.getByRole('alert')).toContainText('Please verify your email first')
  expect(scalar(`SELECT count(*) FROM professional_profiles WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`)).toBe('0')

  // The notice is honest in development: it names the command that gets the link.
  await page.goto('/profile')
  const hint = page.getByTestId('dev-verification-hint')
  await expect(hint).toContainText('no e-mail is sent')
  await expect(page.getByText(/we sent a link/i)).toHaveCount(0) // the development build never claims delivery
  await expect(hint).toContainText(`python -m app.cli.dev_verify ${email}`)
  await context.close()
})

test('the development helper refuses outside development and creates nothing', async () => {
  const before = scalar(`SELECT count(*) FROM auth_tokens WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`)
  for (const environment of ['production', 'staging']) {
    const refused = devVerify(email, undefined, { ENVIRONMENT: environment })
    expect(refused.status, `${environment}: ${refused.stderr}`).toBe(2)
    expect(refused.url).toBeNull()
    expect(refused.stderr).toContain('Refused')
  }
  const unknown = devVerify('nobody.at.all@example.org')
  expect(unknown.status).toBe(1)
  expect(unknown.url).toBeNull()
  const foreign = devVerify(email, 'http://evil.example')
  expect(foreign.status).toBe(1)
  expect(foreign.url).toBeNull()
  expect(scalar(`SELECT count(*) FROM auth_tokens WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`)).toBe(before)
})

test('verified with the helper link: still signed in, then Professional profile + Provider listing + dashboard after reload', async ({ browser }) => {
  const context = await newContext(browser, { baseURL: ORIGIN })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expect(page.getByRole('banner').getByText(name)).toBeVisible()

  // The helper prints the real link; opening it runs the normal verification.
  const issued = devVerify(email, ORIGIN)
  expect(issued.status, issued.stderr).toBe(0)
  expect(issued.url).toMatch(new RegExp(`^${ORIGIN}/verify-email#token=[A-Za-z0-9_-]{20,}$`))
  expect(scalar(`SELECT email_verified_at IS NULL FROM users WHERE email = '${email}'`)).toBe('t') // issuing the link verified nobody

  await page.goto(issued.url!)
  await expect(page.getByText('Your email address is verified. Thank you.')).toBeVisible()
  expect(scalar(`SELECT email_verified_at IS NOT NULL FROM users WHERE email = '${email}'`)).toBe('t')
  expect(scalar(`SELECT count(*) FROM auth_events WHERE event_type = 'email_verified' AND user_id = (SELECT id FROM users WHERE email = '${email}')`)).toBe('1')
  // The session survived the verification (no forced re-login) and the notice is gone.
  await page.goto('/profile')
  await expect(page.getByRole('banner').getByText(name)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Email verification' })).toHaveCount(0)

  // The link works once.
  await page.goto('/')
  await page.goto(issued.url!)
  await expect(page.getByText('This verification link is invalid or has already been used.')).toBeVisible()
  expect(devVerify(email).stderr).toContain('already verified') // and the helper has nothing left to do

  // Professional capability, through the UI, server-backed.
  await page.goto('/provider/listings/new')
  await expect(page.getByText('Professional profile needed')).toBeVisible()
  await page.getByRole('button', { name: 'Create a professional profile' }).click()
  await expectH1(page, 'List Your Business / Service / Property')
  await page.reload()
  await expectH1(page, 'List Your Business / Service / Property')
  expect(scalar(`SELECT plan_code FROM professional_profiles WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`)).toBe('free')

  // A Provider listing, and the owner dashboard after a reload.
  const id = await createProvider(page, {
    name: listing,
    category: 'Plumbing',
    description: 'Plumbing repairs and fittings for homes across B-17, created by a brand new user.',
  })
  await page.reload()
  await expectH1(page, 'Listings')
  await expect(ownerCard(page, listing)).toContainText('Pending Review')
  await expect(ownerCard(page, listing)).toContainText('revision 1')
  expect(rows(`SELECT kind, status, revision FROM listings WHERE id = '${id}'`)[0]).toEqual(['provider', 'pending', '1'])
  expect(scalar(`SELECT count(*) FROM listing_status_history WHERE listing_id = '${id}' AND action = 'submitted'`)).toBe('1')

  // Nothing server-owned was kept in the browser.
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toMatch(/token|session|plan|professional|listing|verified/i)
  await context.close()
})

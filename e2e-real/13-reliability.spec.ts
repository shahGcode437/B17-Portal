import { expect, test, type Page } from '@playwright/test'
import { PASSWORD, createUser, expectH1, loginOn, newContext, type TestUser } from './helpers/stack'
import { publicGet } from './helpers/ui'

/**
 * Phase 12S, S3 - functional reliability: the three confirmed bugs, in a real browser against the real stack.
 *
 *  A. the map-pin logo (header and footer) did nothing visible;
 *  B. a footer link opened its page scrolled to where the old page ended;
 *  C. a signed-in person was sent to Log In (while the session check was running, or the server was unreachable).
 *
 * Plus the related map / navigation defects found by the audit.
 */
test.describe.configure({ mode: 'serial' })

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))

async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => scrollY(page)).toBeGreaterThan(300)
}

let resident: TestUser
let professional: TestUser

test.beforeAll(async () => {
  resident = await createUser('rel-resident')
  professional = await createUser('rel-pro', { professional: 'free' })
})

// ------------------------------------------------------------------------------------------ B + A (navigation)

test.describe('Bug B: every route change starts at the top', () => {
  const FOOTER: [string, string][] = [
    ['Services', '/services'],
    ['Business Directory', '/directory'],
    ['Food & Dining', '/food'],
    ['Education', '/education'],
    ['Property', '/property'],
    ['News & Daily Updates', '/news'],
    ['Marketplace', '/coming-soon'],
    ['List Your Business / Service', '/login'], // anonymous: the Professional area redirects to Log In
  ]

  for (const [label, path] of FOOTER) {
    test(`footer "${label}" opens ${path} at the top`, async ({ browser }) => {
      const context = await newContext(browser)
      const page = await context.newPage()
      await page.goto('/')
      await expectH1(page, 'B-17 Portal')
      await scrollToBottom(page)
      await page.locator('footer').getByRole('link', { name: label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await expect.poll(() => scrollY(page)).toBe(0)
      await context.close()
    })
  }

  test('header navigation and a card link also open at the top; Back leaves the browser in charge', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto('/services')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await scrollToBottom(page)
    await page.getByRole('banner').getByRole('link', { name: 'Education', exact: true }).click()
    await expect(page).toHaveURL(/\/education$/)
    await expect.poll(() => scrollY(page)).toBe(0)

    // A card in the middle of a long page: the detail page it opens starts at the top.
    await page.goto('/search')
    await expect(page.getByRole('button', { name: /^Preview / }).first()).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 600))
    await page.getByRole('button', { name: /^Preview / }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: /View (Profile|Details)|Read More/ }).click()
    await expect(page).toHaveURL(/\/(providers|businesses|tutors|properties)\//)
    await expect.poll(() => scrollY(page)).toBe(0)
    await context.close()
  })

  test('browser Back and Forward still work and do not throw the reader to a wrong place', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto('/')
    await expectH1(page, 'B-17 Portal')
    await scrollToBottom(page)
    const homeY = await scrollY(page)
    await page.locator('footer').getByRole('link', { name: 'Education', exact: true }).click()
    await expect(page).toHaveURL(/\/education$/)
    await expect.poll(() => scrollY(page)).toBe(0)

    await page.goBack()
    await expectH1(page, 'B-17 Portal')
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(() => scrollY(page), { message: 'Back restores (roughly) where the reader was on Home' }).toBeGreaterThan(homeY / 2)

    await page.goForward()
    await expect(page).toHaveURL(/\/education$/)
    await context.close()
  })
})

test.describe('Bug A: the pin logo does something visible', () => {
  test('header logo on Home, scrolled down: glides back to the top', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto('/')
    await expectH1(page, 'B-17 Portal')
    await page.evaluate(() => window.scrollTo(0, 900))
    await expect.poll(() => scrollY(page)).toBeGreaterThan(500)
    await page.getByRole('banner').getByRole('link', { name: 'B-17 Portal home' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(() => scrollY(page)).toBe(0)
    await context.close()
  })

  test('footer logo on Home (the user was at the footer): back to the top, not nothing', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto('/')
    await expectH1(page, 'B-17 Portal')
    await scrollToBottom(page)
    await page.locator('footer').getByRole('link', { name: 'B-17 Portal home' }).click()
    await expect.poll(() => scrollY(page)).toBe(0)
    await context.close()
  })

  test('footer logo on another page: lands on Home at the top (it used to look unchanged)', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto('/services')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await scrollToBottom(page)
    await page.locator('footer').getByRole('link', { name: 'B-17 Portal home' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expectH1(page, 'B-17 Portal')
    await expect.poll(() => scrollY(page)).toBe(0)
    await context.close()
  })
})

// ------------------------------------------------------------------------------------------------------- Bug C

test.describe('Bug C: authentication and capability gating in the listing entry flow', () => {
  test('anonymous: "List Your Business" asks to log in, and signing in brings the person back to the workspace', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto('/')
    await page.getByRole('banner').getByRole('link', { name: 'List Your Business' }).click()
    await expectH1(page, 'Log In')
    await page.getByLabel('Email').fill(professional.email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Log In', exact: true }).click()
    await expectH1(page, 'Overview') // returnTo: the Professional workspace, not Home
    await expect(page).toHaveURL(/\/provider$/)
    await context.close()
  })

  test('resident without a professional profile: told what is needed - never asked to log in again', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await loginOn(page, resident)
    await page.goto('/')
    await page.getByRole('banner').getByRole('link', { name: 'List Your Business' }).click()
    await expectH1(page, 'Professional profile needed')
    await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toHaveCount(0)
    await expect(page).toHaveURL(/\/provider$/)
    await page.reload() // and after a hard reload
    await expectH1(page, 'Professional profile needed')
    await context.close()
  })

  test('professional: the create flow opens directly - after login, hard reload, in-app navigation and Back / Forward', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await loginOn(page, professional)

    await page.goto('/')
    await page.getByRole('banner').getByRole('link', { name: 'List Your Business' }).click()
    await expectH1(page, 'Overview')

    await page.getByRole('link', { name: 'Listings', exact: true }).click()
    await expectH1(page, 'Listings')
    await page.getByRole('link', { name: 'New listing' }).click()
    await expectH1(page, 'List a Service, Business, Tutor or Property')
    await expect(page.getByRole('button', { name: /Service \/ Professional/ })).toBeVisible()

    await page.reload() // hard reload on the create route: the gate waits for /auth/me, then lets the professional in
    await expectH1(page, 'List a Service, Business, Tutor or Property')

    await page.goBack()
    await expectH1(page, 'Listings')
    await page.goForward()
    await expectH1(page, 'List a Service, Business, Tutor or Property')
    await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toHaveCount(0)
    await context.close()
  })

  test('the same professional flow works at localhost:5173 as well', async ({ browser }) => {
    const context = await newContext(browser, { baseURL: 'http://localhost:5173' })
    const page = await context.newPage()
    await loginOn(page, professional)
    await page.goto('/provider/listings/new')
    await expectH1(page, 'List a Service, Business, Tutor or Property')
    await page.reload()
    await expectH1(page, 'List a Service, Business, Tutor or Property')
    await context.close()
  })

  // ---- the reproduced defect: a click made while /auth/me is in flight, or while the server is unreachable
  async function providerId(): Promise<string> {
    const { body } = await publicGet('/search?type=provider&limit=1')
    return body.data[0].item.id as string
  }

  test('Request Service clicked while the session check is still running: no Log In; the form opens once the answer arrives', async ({ browser }) => {
    const id = await providerId()
    const context = await newContext(browser)
    const page = await context.newPage()
    await loginOn(page, resident)
    await page.route('**/api/v1/auth/me', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.continue()
    })
    const visited: string[] = []
    page.on('framenavigated', (frame) => frame === page.mainFrame() && visited.push(new URL(frame.url()).pathname))
    await page.goto(`/providers/${id}`, { waitUntil: 'commit' })
    await page.getByRole('button', { name: 'Request Service' }).click()
    await expect(page.getByRole('dialog', { name: /^Request / })).toBeVisible({ timeout: 10_000 }) // held, then run
    expect(visited.filter((path) => path === '/login')).toEqual([])
    await context.close()
  })

  test('Request Service for an anonymous visitor: Log In first, then straight back into the request form', async ({ browser }) => {
    const id = await providerId()
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto(`/providers/${id}`)
    await page.getByRole('button', { name: 'Request Service' }).click()
    await expectH1(page, 'Log In')
    await page.getByLabel('Email').fill(resident.email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Log In', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/providers/${id}$`))
    await expect(page.getByRole('dialog', { name: /^Request / })).toBeVisible() // the interrupted intent resumes
    await context.close()
  })

  test('an unreachable server is not "logged out": no Log In link, no redirect, and the session is picked up again when it returns', async ({ browser }) => {
    const id = await providerId()
    const context = await newContext(browser)
    const page = await context.newPage()
    await loginOn(page, resident)
    await page.route('**/api/v1/auth/me', (route) => route.abort())
    await page.goto(`/providers/${id}`)
    const header = page.getByRole('banner')
    await expect(header.getByRole('button', { name: 'Reconnect' })).toBeVisible()
    await expect(header.getByRole('link', { name: /log in/i })).toHaveCount(0)

    await page.getByRole('button', { name: 'Request Service' }).click()
    await expect(page.getByText(/couldn't reach the server/i)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/providers/${id}$`)) // not /login
    await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toHaveCount(0)

    // The API comes back: returning to the tab restores the real session without a reload or a retry click.
    await page.unroute('**/api/v1/auth/me')
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(header.getByRole('link', { name: new RegExp(resident.name.slice(0, 12)) })).toBeVisible()
    await expect(header.getByRole('button', { name: 'Reconnect' })).toHaveCount(0)
    await context.close()
  })

  test('the Professional area during an unreachable server shows a retryable error, not Log In', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await loginOn(page, professional)
    await page.route('**/api/v1/auth/me', (route) => route.abort())
    await page.goto('/provider/listings/new')
    await expectH1(page, "We can't reach the server")
    await page.unroute('**/api/v1/auth/me')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expectH1(page, 'List a Service, Business, Tutor or Property')
    await context.close()
  })
})

// ---------------------------------------------------------------------------------------------------------- maps

test.describe('map and location reliability', () => {
  async function hitWith(visibility: string): Promise<{ id: string; kind: string }> {
    const { body } = await publicGet('/search?limit=50')
    const hit = (body.data as { item: Record<string, any> }[]).find(
      (h) => h.item.location?.visibility === visibility && ['business', 'property', 'tutor', 'provider'].includes(h.item.kind)
    )
    expect(hit, `a seeded ${visibility} listing`).toBeTruthy()
    return { id: hit!.item.id as string, kind: hit!.item.kind as string }
  }
  const PATH: Record<string, string> = { business: '/businesses/', property: '/properties/', tutor: '/tutors/', provider: '/providers/' }

  test('exact: a real map with a pin, working zoom controls and a valid Get Directions link', async ({ browser }) => {
    const { id, kind } = await hitWith('exact')
    const context = await newContext(browser)
    await context.route('https://www.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Google Maps (stub)</title>' }))
    const page = await context.newPage()
    await page.goto(`${PATH[kind]}${id}`)
    const map = page.getByTestId('location-map')
    await expect(map).toHaveAttribute('data-map-status', 'ready')
    await expect(map).toHaveAttribute('data-map-mode', 'exact')
    await expect(map.locator('.b17-map-pin')).toBeVisible()
    const zoomOf = () => map.locator('img.leaflet-tile').first().getAttribute('src').then((src) => Number(/\/(\d+)\/\d+\/\d+/.exec(src ?? '')?.[1]))
    const before = await zoomOf()
    await map.getByRole('button', { name: 'Zoom in' }).click()
    await expect.poll(zoomOf).toBe(before + 1)
    const directions = page.getByRole('link', { name: /get directions/i })
    await expect(directions).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-?\d+\.\d+%2C-?\d+\.\d+$/)
    await expect(directions).toHaveAttribute('target', '_blank')
    await expect(directions).toHaveAttribute('rel', /noopener/)

    // The visible marker itself opens the SAME public destination, by mouse and by keyboard.
    const href = (await directions.getAttribute('href'))!
    const pin = map.getByRole('link', { name: 'Open this location in Google Maps' })
    await expect(pin).toHaveAttribute('href', href)
    await expect(pin).toHaveAttribute('target', '_blank')
    await expect(pin).toHaveAttribute('rel', 'noopener noreferrer')
    const [byClick] = await Promise.all([context.waitForEvent('page'), pin.click()])
    await byClick.waitForLoadState()
    expect(byClick.url()).toBe(href)
    await byClick.close()
    await expect(page).toHaveURL(new RegExp(`${PATH[kind]}${id}$`)) // this page stayed where it was
    await pin.focus()
    await expect(pin).toBeFocused()
    const [byKey] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('Enter')])
    await byKey.waitForLoadState()
    expect(byKey.url()).toBe(href)
    await byKey.close()
    await context.close()
  })

  test('approximate: a labelled circle and no directions; area-only: text only, no map, no directions', async ({ browser }) => {
    const approx = await hitWith('approximate')
    const area = await hitWith('area_only')
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto(`${PATH[approx.kind]}${approx.id}`)
    await expect(page.getByTestId('location-map')).toHaveAttribute('data-map-mode', 'approximate')
    await expect(page.getByTestId('location-map').locator('.b17-map-pin')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Open this location in Google Maps' })).toHaveCount(0)
    await expect(page.locator('a[href*="google.com"]')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /get directions/i })).toHaveCount(0)
    await expect(page.getByText('Address', { exact: true })).toHaveCount(0)
    await page.goto(`${PATH[area.kind]}${area.id}`)
    await expect(page.getByRole('main').getByText(/Location shared at area level/)).toBeVisible()
    await expect(page.getByTestId('location-map')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Open this location in Google Maps' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /get directions/i })).toHaveCount(0)
    await context.close()
  })

  test('owner form: typing in the address fields no longer rebuilds the map under the owner (their pan and zoom survive)', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await loginOn(page, professional, '/provider/listings/new')
    await page.getByRole('button', { name: /Business \/ Shop/ }).click()
    const picker = page.getByTestId('map-picker')
    await expect(picker).toHaveAttribute('data-map-status', 'ready')
    await page.evaluate(() => {
      ;(window as unknown as { __map: Element | null }).__map = document.querySelector('[data-testid="map-picker"] .leaflet-container')
    })
    await page.getByLabel('Street address').fill('Shop 4, Demo Plaza')
    await page.getByLabel('Landmark (optional)').fill('Next to the park')
    await page.getByLabel('Block (optional)').fill('C')
    const same = await page.evaluate(
      () => (window as unknown as { __map: Element | null }).__map === document.querySelector('[data-testid="map-picker"] .leaflet-container')
    )
    expect(same, 'the Leaflet container must be the very same element after typing').toBe(true)
    // ... and a click still drops a pin (the latest handler is called).
    await picker.locator('.leaflet-container').click({ position: { x: 120, y: 90 } })
    await expect(page.getByLabel('Latitude')).not.toHaveValue('')
    await context.close()
  })
})

// ------------------------------------------------------------------------------------- navigation / Back button

test.describe('detail pages: the Back button always goes somewhere', () => {
  test('deep link (nothing earlier in this app): Back goes to the section, not nowhere', async ({ browser }) => {
    const { body } = await publicGet('/search?type=provider&limit=1')
    const id = body.data[0].item.id as string
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto(`/providers/${id}`)
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/services$/)
    await context.close()
  })

  test('arrived from Search: Back returns to that Search, exactly as before', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto('/search?q=solar')
    await page.getByRole('button', { name: 'Preview Sunrise Solar Solutions' }).click()
    await page.getByRole('dialog').getByRole('button', { name: /View Profile/ }).click()
    await expect(page).toHaveURL(/\/providers\//)
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/search\?q=solar/)
    await context.close()
  })
})

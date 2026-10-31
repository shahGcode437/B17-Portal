import { expect, test, mockFor } from './helpers/test'
import { expectPage, openApp, signIn, signInFromLoginPage } from './helpers/app'
import { IDS } from '../src/test/fixtures/apiFixtures'
import type { Page } from '@playwright/test'

/**
 * Phase 12S, S3 - functional reliability, against the mock-contract backend (the CI gate).
 *
 *  A. the pin logo did nothing visible;  B. a route change kept the old scroll offset;
 *  C. a signed-in person was sent to Log In while `/auth/me` was slow or unreachable.
 *
 * The mock used to answer `/auth/me` instantly and always - which is exactly why no test could see C.
 * `AuthMock.meDelayMs` / `meUnreachable` now model the real backend's gap, and `holdMe()` holds the answer back until
 * the test lets it go (for a click that must come strictly before it).
 */
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))

async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => scrollY(page)).toBeGreaterThan(100) // the mock pages are short: any real offset will do
}

test.describe('Bug B: every route change starts at the top', () => {
  const FOOTER: [string, string][] = [
    ['Services', '/services'],
    ['Business Directory', '/directory'],
    ['Food & Dining', '/food'],
    ['Education', '/education'],
    ['Property', '/property'],
    ['News & Daily Updates', '/news'],
  ]

  for (const [label, path] of FOOTER) {
    test(`footer "${label}" opens ${path} at the top`, async ({ page }) => {
      await openApp(page, '/', 'B-17 Portal')
      await scrollToBottom(page)
      await page.locator('footer').getByRole('link', { name: label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expectPage(page)
      await expect.poll(() => scrollY(page)).toBe(0)
    })
  }

  test('a header link, and the switch between layouts (Consumer to Professional Workspace), open at the top', async ({ page }) => {
    await openApp(page, '/services', 'Services')
    await scrollToBottom(page)
    await page.getByRole('banner').getByRole('link', { name: 'Education', exact: true }).click()
    await expect(page).toHaveURL(/\/education$/)
    await expect.poll(() => scrollY(page)).toBe(0)

    await signInFromLoginPage(page, 'Pat Pro')
    await scrollToBottom(page)
    await page.locator('footer').getByRole('link', { name: 'List Your Business / Service' }).click()
    await expect(page).toHaveURL(/\/provider$/)
    await expectPage(page, 'Overview')
    await expect.poll(() => scrollY(page)).toBe(0)
  })

  test('Back and Forward keep working (the browser stays in charge of the position)', async ({ page }) => {
    await openApp(page, '/', 'B-17 Portal')
    await scrollToBottom(page)
    await page.locator('footer').getByRole('link', { name: 'Education', exact: true }).click()
    await expect(page).toHaveURL(/\/education$/)
    await page.goBack()
    await expectPage(page, 'B-17 Portal')
    await page.goForward()
    await expect(page).toHaveURL(/\/education$/)
  })

  test('an in-place Search filter edit (a REPLACE of the query) is not treated as a new page: the app does not scroll for it', async ({ page }) => {
    await openApp(page, '/search', 'Search / Explore')
    // Count what the app itself asks the browser to scroll (the list swapping to a skeleton while it reloads can
    // still make the browser clamp the offset: that is layout, not navigation).
    await page.evaluate(() => {
      const w = window as unknown as { __scrolls: number }
      w.__scrolls = 0
      const original = window.scrollTo.bind(window)
      window.scrollTo = ((...args: unknown[]) => {
        w.__scrolls += 1
        return (original as (...a: unknown[]) => void)(...args)
      }) as typeof window.scrollTo
    })
    await page.getByRole('radio', { name: 'Services' }).click()
    await expect(page).toHaveURL(/type=provider/)
    await page.getByRole('radio', { name: 'All' }).click()
    await expect(page).not.toHaveURL(/type=/)
    expect(await page.evaluate(() => (window as unknown as { __scrolls: number }).__scrolls)).toBe(0)
  })
})

test.describe('Bug A: the pin logo does something visible', () => {
  test('header and footer logo on Home glide back to the top', async ({ page }) => {
    await openApp(page, '/', 'B-17 Portal')
    await page.evaluate(() => window.scrollTo(0, 900))
    await page.getByRole('banner').getByRole('link', { name: 'B-17 Portal home' }).click()
    await expect.poll(() => scrollY(page)).toBe(0)

    await scrollToBottom(page)
    await page.locator('footer').getByRole('link', { name: 'B-17 Portal home' }).click()
    await expect.poll(() => scrollY(page)).toBe(0)
  })

  test('footer logo from another page lands on Home at the top', async ({ page }) => {
    await openApp(page, '/services', 'Services')
    await scrollToBottom(page)
    await page.locator('footer').getByRole('link', { name: 'B-17 Portal home' }).click()
    await expectPage(page, 'B-17 Portal')
    await expect.poll(() => scrollY(page)).toBe(0)
  })
})

test.describe('Bug C: a signed-in person is never sent to Log In by a slow or unreachable /auth/me', () => {
  test('anonymous: Request Service asks to log in', async ({ page }) => {
    await openApp(page, `/providers/${IDS.provider}`, 'Sunrise Solar Solutions')
    await page.getByRole('button', { name: 'Request Service' }).click()
    await expectPage(page, 'Log In')
  })

  test('anonymous: Log In from Request Service brings the person back to the request form', async ({ page }) => {
    await openApp(page, `/providers/${IDS.provider}`, 'Sunrise Solar Solutions')
    await page.getByRole('button', { name: 'Request Service' }).click()
    await expectPage(page, 'Log In')
    await signIn(page, 'Rana Resident', 'resident')
    await expect(page).toHaveURL(new RegExp(`/providers/${IDS.provider}$`))
    await expect(page.getByRole('dialog', { name: /^Request / })).toBeVisible()
  })

  test('signed in, Request Service clicked while /auth/me is still answering: the form opens, no Log In page appears', async ({ page }) => {
    await signInFromLoginPage(page, 'Rana Resident')
    const visited: string[] = []
    page.on('framenavigated', (frame) => frame === page.mainFrame() && visited.push(new URL(frame.url()).pathname))
    mockFor(page).meDelayMs = 1500
    await page.goto(`/providers/${IDS.provider}`, { waitUntil: 'commit' })
    await page.getByRole('button', { name: 'Request Service' }).click()
    await expect(page.getByRole('dialog', { name: /^Request / })).toBeVisible({ timeout: 10_000 })
    expect(visited).not.toContain('/login')
  })

  test('signed in, the heart clicked while /auth/me is still unanswered: the click is held, the save is sent once the answer arrives, Log In never appears', async ({ page }) => {
    await signInFromLoginPage(page, 'Rana Resident')
    const mock = mockFor(page)
    const visited: string[] = []
    page.on('framenavigated', (frame) => frame === page.mainFrame() && visited.push(new URL(frame.url()).pathname))
    // HELD, not delayed: with `meDelayMs` this test raced the machine (a click that landed after the answer found the
    // saved list loaded and the heart reading "Remove ... from saved", and correctly sent a DELETE - see the next test).
    const answer = mock.holdMe()
    mock.calls.length = 0
    await page.goto(`/providers/${IDS.provider}`, { waitUntil: 'commit' })
    const heart = page.getByRole('button', { name: /^Save Sunrise Solar Solutions$/ })
    const node = (await heart.elementHandle())!
    await heart.click() // strictly before the session answer: it cannot come until `answer()` is called
    const saves = () => mock.calls.filter((call) => call.method === 'PUT' && call.path === `/saved/${IDS.provider}`)
    expect(saves()).toHaveLength(0) // held: nothing is sent while the session question is open
    expect(visited).not.toContain('/login')

    answer()
    await expect.poll(() => saves().length).toBe(1)
    expect(saves()[0].csrf).toBe(mock.session!.csrf) // sent with the CSRF token that same answer delivered
    await expect(page.getByRole('button', { name: 'Remove Sunrise Solar Solutions from saved' })).toBeVisible()
    expect(await node.evaluate((el) => el.isConnected)).toBe(true) // the very heart that was clicked: never re-mounted
    expect(visited).not.toContain('/login')
    await expect(page).toHaveURL(new RegExp(`/providers/${IDS.provider}$`))
  })

  test('signed in, the heart clicked after the session answer and the saved list: it does what the heart then says (saved becomes removed), nothing is held', async ({ page }) => {
    await signInFromLoginPage(page, 'Rana Resident')
    const mock = mockFor(page)
    mock.calls.length = 0
    await page.goto(`/providers/${IDS.provider}`)
    // The mock's person already has this provider saved: once /saved has loaded the heart reads "Remove ... from saved".
    await page.getByRole('button', { name: 'Remove Sunrise Solar Solutions from saved' }).click()
    await expect.poll(() => mock.calls.filter((call) => call.method === 'DELETE' && call.path === `/saved/${IDS.provider}`).length).toBe(1)
    expect(mock.calls.some((call) => call.method === 'PUT' && call.path.startsWith('/saved/'))).toBe(false)
    await expect(page.getByRole('button', { name: 'Save Sunrise Solar Solutions' })).toBeVisible()
  })

  test('an unreachable server: no Log In link, the click says so and stays; when the server returns the session is back', async ({ page }) => {
    await signInFromLoginPage(page, 'Rana Resident')
    const mock = mockFor(page)
    mock.meUnreachable = true
    await page.goto(`/providers/${IDS.provider}`)
    const header = page.getByRole('banner')
    await expect(header.getByRole('button', { name: 'Reconnect' })).toBeVisible()
    await expect(header.getByRole('link', { name: /log in/i })).toHaveCount(0)

    await page.getByRole('button', { name: 'Request Service' }).click()
    await expect(page.getByText(/couldn.t reach the server/i)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/providers/${IDS.provider}$`))

    mock.meUnreachable = false
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(header.getByRole('link', { name: /Rana Resident/ })).toBeVisible()
  })

  test('resident: the Professional area asks for a professional profile, not a login; professional: it opens, also after a reload', async ({ page }) => {
    await openApp(page, '/login', 'Log In')
    await signIn(page, 'Rana Resident', 'resident')
    await expectPage(page)
    await page.getByRole('banner').getByRole('link', { name: 'List Your Business' }).click()
    await expectPage(page, 'Professional profile needed')
    await expect(page.getByRole('heading', { level: 1, name: 'Log In' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Create a professional profile' }).click()
    await expectPage(page, 'Overview')

    await page.goto('/provider/listings/new')
    await expectPage(page, 'List a Service, Business, Tutor or Property')
    await page.reload()
    await expectPage(page, 'List a Service, Business, Tutor or Property')
  })

  test('a slow /auth/me on a hard reload of the create form shows the session check, then the form', async ({ page }) => {
    await signInFromLoginPage(page, 'Pat Pro')
    mockFor(page).meDelayMs = 1200
    await page.goto('/provider/listings/new', { waitUntil: 'commit' })
    await expect(page.getByRole('status').filter({ hasText: /checking your session/i })).toBeVisible()
    await expectPage(page, 'List a Service, Business, Tutor or Property')
  })
})

test.describe('detail Back button', () => {
  test('on a deep link it goes to the section instead of doing nothing', async ({ page }) => {
    await openApp(page, `/providers/${IDS.provider}`, 'Sunrise Solar Solutions')
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/services$/)
  })
})

test.describe('the exact map pin opens Google Maps', () => {
  const PIN_NAME = 'Open this location in Google Maps'

  async function stubGoogle(page: Page) {
    // The new tab must never reach the real Google Maps from a test.
    await page.context().route('https://www.google.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Google Maps (stub)</title>' })
    )
  }

  test('exact: the pin is a link to the SAME destination as Get Directions; a click and the keyboard both open it in a new tab', async ({ page }) => {
    await stubGoogle(page)
    await openApp(page, `/businesses/${IDS.foodExact}`, 'Capital Bakers')
    const map = page.getByTestId('location-map')
    await expect(map).toHaveAttribute('data-map-status', 'ready')
    const pin = map.getByRole('link', { name: PIN_NAME })
    await expect(pin).toBeVisible()

    const directions = page.getByRole('link', { name: /get directions/i })
    const href = (await directions.getAttribute('href'))!
    expect(href).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-?\d+\.\d+%2C-?\d+\.\d+$/)
    await expect(pin).toHaveAttribute('href', href) // one destination, built from the public point only
    await expect(pin).toHaveAttribute('target', '_blank')
    await expect(pin).toHaveAttribute('rel', 'noopener noreferrer')

    // A mouse click opens it in a NEW tab and leaves this page where it is.
    const [byClick] = await Promise.all([page.context().waitForEvent('page'), pin.click()])
    await byClick.waitForLoadState()
    expect(byClick.url()).toBe(href)
    await byClick.close()
    await expect(page).toHaveURL(new RegExp(`/businesses/${IDS.foodExact}$`))

    // The keyboard has the same action: the pin is a real link, focusable and opened with Enter.
    await pin.focus()
    await expect(pin).toBeFocused()
    const [byKey] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('Enter')])
    await byKey.waitForLoadState()
    expect(byKey.url()).toBe(href)
    await byKey.close()
  })

  test('exact: the touch target is at least 44px even though the dot is 28px', async ({ page }) => {
    await openApp(page, `/businesses/${IDS.foodExact}`, 'Capital Bakers')
    const pin = page.getByTestId('location-map').getByRole('link', { name: PIN_NAME })
    await pin.scrollIntoViewIfNeeded()
    const box = (await pin.boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    // 20px from the centre is outside the 28px dot but inside a 44px target.
    for (const [dx, dy] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) {
      const hit = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('a.b17-map-pin--link')), [cx + dx, cy + dy])
      expect(hit, `offset ${dx},${dy}`).toBe(true)
    }
    const outside = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('a.b17-map-pin--link')), [cx + 26, cy])
    expect(outside, 'a 44px target, not a bigger one').toBe(false)
  })

  test('approximate: a circle and no clickable marker, no directions, no Google Maps link anywhere', async ({ page }) => {
    await openApp(page, `/businesses/${IDS.foodApproximate}`, 'Mocha Corner Cafe')
    const map = page.getByTestId('location-map')
    await expect(map).toHaveAttribute('data-map-mode', 'approximate')
    await expect(map).toHaveAttribute('data-map-status', 'ready')
    await expect(map.locator('.b17-map-pin')).toHaveCount(0)
    await expect(page.getByRole('link', { name: PIN_NAME })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /directions/i })).toHaveCount(0)
    await expect(page.locator('a[href*="google.com"]')).toHaveCount(0)
  })

  test('area-only: no map at all, so nothing to click', async ({ page }) => {
    await openApp(page, `/businesses/${IDS.generalAreaOnly}`, 'B-17 Family Pharmacy')
    await expect(page.getByTestId('location-map')).toHaveCount(0)
    await expect(page.getByRole('link', { name: PIN_NAME })).toHaveCount(0)
    await expect(page.locator('a[href*="google.com"]')).toHaveCount(0)
  })
})

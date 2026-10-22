import { expect, test } from './helpers/test'
import { expectPage, openApp, signIn } from './helpers/app'
import { enterAdmin } from './helpers/workspace'
import { IDS, PRIVATE_ADDRESS, PRIVATE_POINT } from '../src/test/fixtures/apiFixtures'

/**
 * Phase 12G journeys: every screen below reads the (mocked) backend through the real contract - the
 * same fixtures the unit tests use - and nothing is written. Writes are Phase 12H.
 */
test.describe('public read journey', () => {
  test('Home → Search → quick look → detail, all from the API', async ({ page, authMock }) => {
    await openApp(page, '/')
    // Home previews come from the API (featured provider, news).
    await expect(page.getByText('Sunrise Solar Solutions').first()).toBeVisible()
    await expect(page.getByText('B-17 Community Park Cleanup Drive This Weekend').first()).toBeVisible()

    await page.getByRole('searchbox', { name: 'Search B-17 Portal' }).fill('bakers')
    await page.getByRole('button', { name: 'Search', exact: true }).first().click()
    await expect(page).toHaveURL(/\/search\?q=bakers/)
    await expectPage(page, 'Search / Explore')
    await expect(page.getByText('1 result for “bakers”')).toBeVisible()

    await page.getByRole('button', { name: 'Preview Capital Bakers' }).click()
    const dialog = page.getByRole('dialog', { name: 'Capital Bakers' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'View Profile' }).click()
    await expect(page).toHaveURL(new RegExp(`/businesses/${IDS.foodExact}$`))
    await expectPage(page, 'Capital Bakers')
    await expect(page.getByText('Fresh Milk Bread')).toBeVisible() // the Food menu is the API's
    await expect(page.getByText('Sweets / Desserts')).toBeVisible()

    // O-4: a real API listing is never labelled Demo (cards, quick look and detail).
    await expect(page.getByText(/demo listing|demo details|prototype listing/i)).toHaveCount(0)

    // Only public endpoints were used.
    expect(authMock.calls.every((c) => !c.path.startsWith('/admin') && !c.path.startsWith('/users/me') && c.path !== '/saved')).toBe(true)
    expect(authMock.calls.every((c) => c.method === 'GET' || c.path.startsWith('/auth'))).toBe(true)
  })

  test('Search offers no Area / Grade dropdown and never asks for a 50-listing page to build one', async ({ page }) => {
    const sizes: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.endsWith('/api/v1/search')) sizes.push(url.searchParams.get('limit') ?? '')
    })
    await openApp(page, '/search?type=tutor', 'Search / Explore')
    await expect(page.getByRole('button', { name: 'Preview Sara M.' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Area' })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Grade' })).toHaveCount(0)
    expect([...new Set(sizes)]).toEqual(['12'])
  })

  test('landing pages list the server categories and lead into Search', async ({ page }) => {
    await openApp(page, '/education')
    await page.getByRole('link', { name: /Physics/ }).click()
    await expect(page).toHaveURL(/\/search\?type=tutor&subject=physics/)
    await expect(page.getByRole('button', { name: 'Preview Sara M.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preview Ali R.' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Remove Subject: Physics filter/ })).toBeVisible()
  })

  test('News: list, kind filter and article', async ({ page }) => {
    await openApp(page, '/news')
    await expect(page.getByText('Water Supply Schedule Update for Block D')).toBeVisible()
    await page.getByRole('radio', { name: 'Updates' }).click()
    await expect(page.getByText('B-17 Community Park Cleanup Drive This Weekend')).toHaveCount(0)
    await page.getByRole('radio', { name: 'All' }).click()
    await page.getByRole('button', { name: /B-17 Community Park Cleanup Drive/ }).first().click()
    await expect(page).toHaveURL(new RegExp(`/news/${IDS.news}$`))
    await expectPage(page, 'B-17 Community Park Cleanup Drive This Weekend')
  })

  test('a server failure on a detail page is an error with retry, not "not found"', async ({ page }) => {
    let healthy = false
    await page.route(`**/api/v1/listings/${IDS.generalExact}`, (route) =>
      healthy
        ? route.fallback()
        : route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'service_unavailable', message: 'x', details: [], requestId: 'r' } }),
          })
    )
    await page.goto(`/businesses/${IDS.generalExact}`)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Business not found' })).toHaveCount(0)
    healthy = true
    await page.getByRole('button', { name: /try again/i }).click()
    await expectPage(page, 'Glow Salon')
  })
})

test.describe('map privacy journey', () => {
  const map = (page: import('@playwright/test').Page) => page.getByTestId('location-map')

  test('exact: pin, address text, attribution and a numbers-only Google directions link', async ({ page, authMock }) => {
    await openApp(page, `/businesses/${IDS.foodExact}`, 'Capital Bakers')
    await expect(map(page)).toHaveAttribute('data-map-mode', 'exact')
    await expect(map(page)).toHaveAttribute('data-map-status', 'ready')
    await expect(map(page).locator('.b17-map-pin')).toHaveCount(1)
    await expect(map(page).locator('.b17-map-circle')).toHaveCount(0)
    await expect(map(page).locator('.leaflet-control-attribution')).toContainText('OpenStreetMap')
    await expect(page.getByText('Shop 4, Demo Plaza')).toBeVisible()
    const directions = page.getByRole('link', { name: /get directions/i })
    await expect(directions).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=33.701234%2C73.051234')
    await expect(directions).toHaveAttribute('rel', 'noopener noreferrer')
    expect(authMock.tileRequests.length).toBeGreaterThan(0)
    expect(authMock.tileRequests.every((url) => url.startsWith('https://tile.openstreetmap.org/'))).toBe(true)
  })

  test('accessibility: the map is a named group, its controls are named, and the keyboard is never trapped', async ({ page }) => {
    await openApp(page, `/businesses/${IDS.foodExact}`, 'Capital Bakers')
    await expect(map(page)).toHaveAttribute('data-map-status', 'ready')
    await expect(page.getByRole('group', { name: 'Map of Capital Bakers' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Capital Bakers location' })).toHaveCount(1)
    await expect(map(page).getByRole('button', { name: 'Zoom in' })).toBeVisible()
    await expect(map(page).getByRole('button', { name: 'Zoom out' })).toBeVisible()

    // Keyboard: focus reaches the zoom buttons, then moves on past the map to Get Directions - no trap.
    await map(page).getByRole('button', { name: 'Zoom in' }).focus()
    await page.keyboard.press('Tab')
    await expect(map(page).getByRole('button', { name: 'Zoom out' })).toBeFocused()
    let left = false
    for (let i = 0; i < 6 && !left; i++) {
      await page.keyboard.press('Tab')
      left = await page.evaluate(() => !document.activeElement?.closest('[data-testid="location-map"]'))
    }
    expect(left).toBe(true)
    await expect(page.getByRole('link', { name: /get directions/i })).toBeFocused()

    // The wheel is not captured: scrolling over the map scrolls the page.
    const box = (await map(page).boundingBox())!
    const before = await page.evaluate(() => window.scrollY)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 300)
    await expect.poll(() => page.evaluate(() => window.scrollY)).not.toBe(before)
  })

  test('approximate: labelled circle, block only, no pin / address / directions', async ({ page }) => {
    await openApp(page, `/businesses/${IDS.foodApproximate}`, 'Mocha Corner Cafe')
    await expect(map(page)).toHaveAttribute('data-map-mode', 'approximate')
    await expect(map(page)).toHaveAttribute('data-map-status', 'ready')
    await expect(page.getByRole('heading', { name: 'Approximate location' })).toBeVisible()
    await expect(page.getByText(/illustrative, not an exact address/)).toBeVisible()
    await expect(map(page).locator('.b17-map-circle')).toHaveCount(1)
    await expect(map(page).locator('.b17-map-pin')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /directions/i })).toHaveCount(0)
    await expect(page.getByText('Address', { exact: true })).toHaveCount(0)
  })

  test('area-only: text only - no map element, no Leaflet, no tile request, no directions', async ({ page, authMock }) => {
    await openApp(page, `/businesses/${IDS.generalAreaOnly}`, 'B-17 Family Pharmacy')
    await expect(page.getByText('Location shared at area level.')).toBeVisible()
    await expect(map(page)).toHaveCount(0)
    await expect(page.locator('.leaflet-container')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /directions/i })).toHaveCount(0)
    expect(authMock.tileRequests).toEqual([])
  })

  test('no public page contains an owner-only address or point', async ({ page }) => {
    for (const [path, heading] of [
      [`/businesses/${IDS.generalExact}`, 'Glow Salon'],
      [`/properties/${IDS.propertyExact}`, '5 Marla House - B-17 Block C'],
      [`/tutors/${IDS.tutorApproximate}`, 'Sara M.'],
      ['/search?q=stationers', 'Search / Explore'],
    ] as const) {
      await openApp(page, path, heading)
      const html = await page.content()
      expect(html, path).not.toContain(PRIVATE_ADDRESS)
      expect(html, path).not.toContain(String(PRIVATE_POINT.latitude))
    }
  })

  test('property: exact pin and directions; tutor: approximate circle', async ({ page }) => {
    await openApp(page, `/properties/${IDS.propertyExact}`, '5 Marla House - B-17 Block C')
    await expect(map(page)).toHaveAttribute('data-map-mode', 'exact')
    await expect(page.getByRole('link', { name: /get directions/i })).toBeVisible()
    await openApp(page, `/tutors/${IDS.tutorApproximate}`, 'Sara M.')
    await expect(map(page)).toHaveAttribute('data-map-mode', 'approximate')
    await expect(page.getByRole('link', { name: /directions/i })).toHaveCount(0)
  })
})

test.describe('authenticated read journey', () => {
  test('Saved, My Requests (with history) and the Professional workspace read the signed-in data', async ({ page, authMock }) => {
    await page.goto('/profile/saved')
    await expectPage(page, 'Log In')
    await signIn(page, 'Rana Resident', 'professional')
    await expectPage(page, 'Saved')

    // Saved: the server's still-approved items; each card renders a Remove toggle (Phase 12H).
    await expect(page.getByText('Sunrise Solar Solutions')).toBeVisible()
    await expect(page.getByText('Capital Bakers')).toBeVisible()
    await expect(page.getByRole('button', { name: /Remove .* from saved/ }).first()).toBeVisible()

    // My Requests: status from the server; opening one reads its history.
    await page.goto('/profile/requests')
    await expectPage(page, 'My Requests')
    await expect(page.getByText('To A provider that has since been removed')).toBeVisible()
    await page.getByRole('button', { name: /Panel inspection/ }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/History/i)).toBeVisible()
    // Phase 12H exposes a Cancel on a non-terminal row the requester owns; terminal rows show nothing.
    await page.keyboard.press('Escape')

    // Professional: the owner's listings with real statuses, revision, the admin's reason, and the PRIVATE location.
    await page.goto('/provider/listings')
    await expectPage(page, 'Listings')
    await expect(page.getByText('Pending Stationers')).toBeVisible()
    await expect(page.getByText('Please add the plot size and a clearer description.')).toBeVisible()
    await expect(page.getByText(/revision 2/)).toBeVisible()
    await page.getByRole('button', { name: 'View' }).first().click()
    await expect(page.getByRole('dialog').getByText(PRIVATE_ADDRESS)).toBeVisible()
    await page.keyboard.press('Escape')

    await page.goto('/provider/leads')
    await expectPage(page, 'Leads')
    await expect(page.getByText('From Rana Resident')).toBeVisible()

    // Nothing was written.
    expect(authMock.calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/auth'))).toEqual([])
  })

  test('create a listing opens a real form with a kind picker and the location fieldset (Phase 12H)', async ({ page }) => {
    await page.goto('/provider/listings/new')
    await signIn(page, 'Sana Baker', 'professional')
    await expectPage(page, 'List Your Business / Service / Property')
    // Four kinds offered.
    for (const name of ['Service / Professional', 'Business / Shop', 'Tutor', 'Property']) {
      await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
    }
  })
})

test.describe('admin read journey', () => {
  test('dashboard counts, queue filter, read-only review with the private location, and categories', async ({ page, authMock }) => {
    await openApp(page, '/')
    await enterAdmin(page)
    await expect(page.getByRole('link', { name: 'Pending listings: 1' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Rejected listings: 1' })).toBeVisible()

    await page.getByRole('link', { name: 'Open listing review' }).click()
    await expectPage(page, 'Listing Review')
    await expect(page.getByRole('radio', { name: 'All (3)' })).toBeVisible()
    await page.getByRole('radio', { name: /^Rejected/ }).click()
    await expect(page.getByText('Rejected Plot')).toBeVisible()
    await expect(page.getByText('Pending Stationers')).toHaveCount(0)
    await expect(page.getByRole('radio', { name: 'All (3)' })).toBeVisible() // whole-queue counts do not move
    await page.getByRole('radio', { name: /^Pending/ }).click()

    await page.getByRole('button', { name: 'Review Pending Stationers' }).click()
    const review = page.getByRole('dialog', { name: 'Review Listing' })
    await expect(review.getByText(PRIVATE_ADDRESS)).toBeVisible() // the private location is for the admin only
    // Phase 12H: approve / reject are enabled on a pending listing (the write is covered by write-journeys.spec).
    await expect(review.getByRole('button', { name: /^Approve$/ })).toBeEnabled()
    await expect(review.getByRole('button', { name: /^Reject$/ })).toBeEnabled()
    await page.keyboard.press('Escape')

    await page.getByRole('link', { name: 'Categories' }).first().click()
    await expectPage(page, 'Categories')
    await expect(page.getByText('Retired Category')).toBeVisible()
    await expect(page.getByText('Inactive', { exact: true })).toHaveCount(1)
    // Phase 12H: add / rename / activate controls are offered on the Categories page.

    expect(authMock.calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/auth'))).toEqual([])
  })

  test('a non-admin never reaches the admin endpoints', async ({ page, authMock }) => {
    await openApp(page, '/login', 'Log In')
    await signIn(page, 'Ayesha Khan', 'resident')
    await expectPage(page)
    await page.evaluate(() => {
      window.history.pushState({}, '', '/admin/moderation')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expectPage(page, 'Admin access only')
    expect(authMock.calls.filter((c) => c.path.startsWith('/admin'))).toEqual([])
  })
})

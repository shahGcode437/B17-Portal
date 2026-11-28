import { expect, test } from '../helpers/test'
import { expectPage, openApp, signIn } from '../helpers/app'

/** The cover shown while it isn't known who is signed in, on the narrowest phones the app supports. */
for (const width of [375, 320]) {
  test(`the sign-in check fits a ${width}px phone and its button is thumb-sized`, async ({ page, authMock }) => {
    await page.setViewportSize({ width, height: 640 })
    await openApp(page, '/login', 'Log In')
    await signIn(page, 'Ayesha Khan', 'resident')
    await expectPage(page)

    authMock.meUnreachable = true
    await page.evaluate(() => {
      new BroadcastChannel('b17-auth').postMessage({ type: 'b17:auth-changed' })
    })

    const cover = page.getByRole('alertdialog')
    await expect(cover).toContainText("We couldn't check who is signed in")
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0) // nothing beneath is reachable
    const button = cover.getByRole('button', { name: 'Try again' })
    const box = (await button.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

    authMock.meUnreachable = false
    await page.keyboard.press('Tab')
    await expect(button).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(cover).toHaveCount(0)
    await expectPage(page)
  })
}

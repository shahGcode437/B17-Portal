/**
 * What a verified e-mail address unlocks, said the same way on every surface that asks for verification (the Profile
 * notice, the unverified banner, the "Verify your email first" gates). Backend authority is unchanged: the API
 * refuses these actions with `403 email_not_verified` whatever any screen says.
 *
 * Production wording never claims an e-mail was sent: production e-mail delivery does not exist yet (Phase 13), so
 * the copy says what verification is for and where to do it, not that a message is on its way.
 */
export const VERIFICATION_UNLOCKS = "create a professional profile, list a business, service, tutor or property, or send a service request"

/** The sentence the Profile notice and the gates use for why verification matters; browsing never needs it. */
export const VERIFICATION_REASON = `Verifying your email lets you ${VERIFICATION_UNLOCKS}. Browsing works either way.`

/** The same reason, shortened for the banner that sits above every page (it must stay a few lines on a phone). */
export const VERIFICATION_BANNER_REASON = "Verifying lets you list a business, service, tutor or property, or send a request. Browsing works either way."

/**
 * What a verified e-mail address unlocks, said the same way on every surface that asks for verification (the Profile
 * notice, the unverified banner, the "Verify your email first" gates). Backend authority is unchanged: the API
 * refuses these actions with `403 email_not_verified` whatever any screen says.
 *
 * No wording ever claims an e-mail was sent or delivered. Where the server reports a real provider the copy tells
 * the person where to LOOK (`CHECK_INBOX`); otherwise it only says what verification is for (`config/devMail`).
 */
export const VERIFICATION_UNLOCKS = "create a professional profile, list a business, tutor or property, or send a service request"

/** The sentence the Profile notice and the gates use for why verification matters; browsing never needs it. */
export const VERIFICATION_REASON = `Verifying your email lets you ${VERIFICATION_UNLOCKS}. Browsing works either way.`

/** Where to look when the server really sends mail. Guidance, never a statement that a message arrived. */
export const CHECK_INBOX = "Check your inbox and spam folder"

/** The same reason, shortened for the banner that sits above every page (it must stay a few lines on a phone). */
export const VERIFICATION_BANNER_REASON = "Verifying lets you list a business, tutor or property, or send a service request. Browsing works either way."

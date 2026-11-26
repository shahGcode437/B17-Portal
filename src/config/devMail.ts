import type { EmailDelivery } from "@/types/auth"

/**
 * What a screen may truthfully say about e-mail (EMAIL-1). The BACKEND is the authority: it reports how it handles
 * mail (`emailDelivery` on the account and on the forgot-password reply), so a screen never relies on a second
 * frontend setting that could disagree with the server.
 *
 *  - `inbox`   - a real provider is configured: tell the person to check their inbox and spam folder. This is still
 *                never a claim that a message was sent or delivered.
 *  - `console` - development build, mail is only printed in the API terminal: say that nothing is e-mailed.
 *  - `off`     - development build, delivery is switched off: nothing is e-mailed and nothing is printed.
 *  - `neutral` - a production build without a real provider (or an unknown mode there): say what was requested and
 *                nothing about mail arriving.
 *
 * The two development modes depend on `import.meta.env.DEV`, read at call time, so a production build never shows
 * development text whatever a server reports. A development build that has not been told anything assumes `console`,
 * the backend's development default.
 */
export type MailMode = "inbox" | "console" | "off" | "neutral"

/**
 * The last mode the server reported. It describes the server's configuration, not a person, and exists for copy
 * that is built outside a component (`lib/api/writeErrors`). Components pass the value they hold.
 */
let reported: EmailDelivery | undefined

export function rememberEmailDelivery(delivery: EmailDelivery | undefined): void {
  reported = delivery
}

export function mailMode(delivery: EmailDelivery | undefined = reported): MailMode {
  if (delivery === "email") return "inbox"
  if (!import.meta.env.DEV) return "neutral"
  return delivery === "off" ? "off" : "console"
}

/** The command that prints a verification link for a local account (development only). */
export function devVerifyCommand(email: string): string {
  return `python -m app.cli.dev_verify ${email}`
}

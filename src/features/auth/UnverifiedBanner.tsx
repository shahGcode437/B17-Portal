import { MailWarning } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { useAuth } from "@/hooks/useAuth"
import { isDevMail } from "@/config/devMail"
import { routes } from "@/config/routes"
import { VERIFICATION_BANNER_REASON } from "@/features/auth/verificationCopy"

/** Screens that already carry the full verification notice (or ARE the verification step): the banner stays out. */
const QUIET_PATHS: readonly string[] = [routes.profile, routes.verifyEmail]

/**
 * A slim, persistent reminder under the header for a signed-in account whose e-mail is not verified (S5A). A new
 * account used to land on the site with no hint that creating a profile, listing or requesting needs verification
 * until an action failed. It is not a modal and not dismissible (it disappears the moment the account is
 * verified); the Profile page it links to holds the full notice with the resend button.
 *
 * Production wording says what verification is for and where to do it - never that an e-mail was sent, because
 * production e-mail delivery does not exist yet. The development line is the only place that mentions the dev
 * helper, and it is compiled out of production builds (`isDevMail`). Nothing here verifies anyone or relaxes a
 * gate: the API is the authority (`403 email_not_verified`).
 */
function UnverifiedBanner() {
  const { status, user } = useAuth()
  const { pathname } = useLocation()

  if (status !== "authenticated" || !user || user.emailVerified) return null
  if (QUIET_PATHS.includes(pathname.replace(/\/+$/, "") || "/")) return null

  return (
    <aside aria-label="Your email is not verified" className="border-b border-warning/30 bg-warning/10">
      <Container className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <MailWarning className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden="true" />
          <p className="min-w-0 text-sm text-foreground">
            <span className="font-medium">Verify your email.</span>{" "}
            <span className="text-muted-foreground">
              {isDevMail() ? "Development: no e-mail is sent; your Profile shows how to verify. " : ""}
              {VERIFICATION_BANNER_REASON}
            </span>
          </p>
        </div>
        <Link
          to={routes.profile}
          className="inline-flex min-h-11 shrink-0 items-center pl-7 text-sm font-medium text-primary underline-offset-4 hover:underline sm:pl-0"
        >
          Open your Profile
        </Link>
      </Container>
    </aside>
  )
}

export { UnverifiedBanner }

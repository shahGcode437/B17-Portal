import { useCallback, useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/hooks/useToast"
import { routes } from "@/config/routes"

interface Intent {
  run: () => void | Promise<void>
  /** Where Log In sends the person back to (path + query of the page they acted on). */
  from: string
  /** Extra Log In state, e.g. which provider's Request Service to reopen. */
  loginState: Record<string, string>
}

export interface SignInGateOptions {
  loginState?: Record<string, string>
}

const UNREACHABLE = "We couldn't reach the server. Your account is unchanged - please try again."

/**
 * "This action needs a signed-in person" (Phase 12S, S3), for a button on a page that anyone can open
 * (Save, Request Service). It decides from the REAL auth state, and keeps the three not-signed-in states apart:
 *
 *  - authenticated -> the action runs now;
 *  - anonymous     -> Log In, remembering the page (and any extra `loginState`);
 *  - loading       -> the answer to `/auth/me` is still on its way (a deep link, a reload): the click is held and
 *                     settles the moment the answer arrives. It used to be treated as "anonymous", which threw
 *                     a signed-in person at the Log In page and swallowed their click;
 *  - unavailable   -> the server could not be reached, which says nothing about whether they are signed in: say
 *                     so, re-check the session once, and then settle like any other click.
 *
 * Only the latest click is held. This is UX only: the API still authenticates and authorises every write.
 */
export function useSignInGate(): { requireSignIn: (run: Intent["run"], options?: SignInGateOptions) => void } {
  const { status, retryBootstrap } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { show } = useToast()
  const held = useRef<Intent | null>(null)

  const toLogIn = useCallback(
    (intent: Intent) => navigate(routes.login, { state: { from: intent.from, ...intent.loginState } }),
    [navigate]
  )

  // A held click settles as soon as the session question has an answer.
  useEffect(() => {
    const intent = held.current
    if (!intent || status === "loading") return
    held.current = null
    if (status === "authenticated") void intent.run()
    else if (status === "anonymous") toLogIn(intent)
    else show(UNREACHABLE, { tone: "error" })
  }, [status, show, toLogIn])

  const requireSignIn = useCallback(
    (run: Intent["run"], options?: SignInGateOptions) => {
      const intent: Intent = { run, from: `${location.pathname}${location.search}`, loginState: options?.loginState ?? {} }
      if (status === "authenticated") {
        void run()
      } else if (status === "anonymous") {
        toLogIn(intent)
      } else {
        held.current = intent
        if (status === "unavailable") retryBootstrap()
      }
    },
    [status, location.pathname, location.search, retryBootstrap, toLogIn]
  )

  return { requireSignIn }
}

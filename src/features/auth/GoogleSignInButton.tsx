import { useState } from "react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { startGoogleSignIn } from "@/lib/api/auth"
import { NETWORK_ERROR_CODE, isApiError } from "@/lib/api/errors"
import { assignLocation, isNavigableProviderUrl } from "@/lib/navigation"
import { backendReturnTo } from "@/lib/safePath"
import { GOOGLE_UNAVAILABLE, authErrorMessage } from "@/features/auth/authMessages"

/**
 * "Continue with Google" (Phase 12C). The SPA only asks the backend to START the flow, then does a
 * full-page navigation to the provider URL the backend returns. The callback, the code exchange and
 * the ID-token checks all happen on the backend, which ends by redirecting the browser back here —
 * where the normal `/auth/me` bootstrap discovers the session. No Google SDK, token, code, state or
 * nonce ever reaches React, and the returned URL is neither stored nor shown.
 */
function GoogleSignInButton({ returnTo }: { returnTo?: string }) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function start() {
    setPending(true)
    setMessage(null)
    try {
      const url = await startGoogleSignIn(backendReturnTo(returnTo))
      if (!isNavigableProviderUrl(url)) throw new Error("unusable provider url")
      assignLocation(url)
      // Stay "pending": the page is about to be replaced.
    } catch (cause) {
      setPending(false)
      if (isApiError(cause) && cause.code === "service_unavailable") setMessage(GOOGLE_UNAVAILABLE)
      else if (isApiError(cause) && cause.code === NETWORK_ERROR_CODE) setMessage(authErrorMessage(cause))
      else setMessage("We couldn't start Google sign-in. Please try again.")
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" size="lg" className="w-full" onClick={start} disabled={pending}>
        <GoogleMark />
        {pending ? "Opening Google…" : "Continue with Google"}
      </Button>
      {message && (
        <Typography variant="caption" className="text-destructive" role="alert">
          {message}
        </Typography>
      )}
    </div>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.42-1.67 4.16-5.35 4.16-3.22 0-5.85-2.67-5.85-5.96S8.78 6.32 12 6.32c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.68 3.77 14.55 2.8 12 2.8 6.9 2.8 2.8 6.9 2.8 12s4.1 9.2 9.2 9.2c5.31 0 8.83-3.73 8.83-8.99 0-.6-.07-1.06-.15-1.11z"
      />
    </svg>
  )
}

export { GoogleSignInButton }

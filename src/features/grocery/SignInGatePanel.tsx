import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { LogIn, WifiOff } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/feedback/EmptyState"
import { VerificationNotice } from "@/features/auth/VerificationNotice"
import { useAuth } from "@/hooks/useAuth"
import { routes } from "@/config/routes"

/** Delivery details belong to an account, so they are only asked for once someone is signed in. */
function SignInPanel({ from }: { from: string }) {
  const navigate = useNavigate()
  return (
    <div className="glass-panel flex flex-col items-center gap-4 rounded-2xl p-6 text-center sm:p-8">
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
        <LogIn className="size-6" />
      </span>
      <Typography as="h2" variant="h3">
        Sign in to add delivery details
      </Typography>
      <Typography variant="body" className="max-w-md text-muted-foreground">
        Orders are sent from an account with a verified email address. Your list stays here while you sign in with your
        email.
      </Typography>
      <Button className="h-11 px-6" onClick={() => navigate(routes.login, { state: { from } })}>
        Log in or create an account
      </Button>
    </div>
  )
}

function AuthUnreachable() {
  const { retryBootstrap } = useAuth()
  return (
    <EmptyState
      icon={WifiOff}
      title="We can't reach the server"
      description="Check your connection and try again. Your list is still here."
      actionLabel="Try again"
      onAction={retryBootstrap}
    />
  )
}

/** For a signed-in but unverified account: the usual notice, and a way to say "I've done it". */
function VerifyToOrder() {
  const { user, refreshMe } = useAuth()
  const [state, setState] = useState<"idle" | "checking" | "still">("idle")
  if (!user || user.emailVerified) return null

  async function check() {
    setState("checking")
    await refreshMe({ fresh: true })
    setState("still") // a verified answer unmounts this notice
  }

  return (
    <div className="flex flex-col gap-2">
      <VerificationNotice />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="h-11" onClick={() => void check()} disabled={state === "checking"}>
          {state === "checking" ? "Checking…" : "I've verified my email"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {state === "still" ? "Your email isn't verified yet. Open the link, then check again." : ""}
        </p>
      </div>
      <Typography variant="body-sm" className="text-muted-foreground">
        Open the verification link in a new tab and keep this one open, so your list isn't lost.
      </Typography>
    </div>
  )
}

export { SignInPanel, AuthUnreachable, VerifyToOrder }

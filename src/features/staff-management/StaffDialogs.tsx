import { useId, useState } from "react"
import { KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Typography } from "@/components/foundation/Typography"
import { CheckField } from "@/components/forms/CheckField"
import { ConfirmDialog } from "@/components/forms/ConfirmDialog"
import { FieldError } from "@/components/forms/FieldError"
import { FormAlert } from "@/components/forms/FormAlert"
import { AttentionRegion } from "@/features/grocery/AttentionRegion"
import { GroceryField } from "@/features/grocery/GroceryField"
import { describedBy, groceryInputClass } from "@/features/grocery/fieldStyles"
import { needsRecentSignIn, staffAdminRefusal } from "@/features/staff-management/staffAdminErrors"
import { assertUnchanged } from "@/features/staff-management/staffData"
import { ASSIGNABLE_SCOPES, SCOPE_INFO, sameAccess, scopeNames } from "@/features/staff-management/staffLabels"
import { appointModerator, pauseModerator, removeModerator, replaceModeratorScopes, resumeModerator } from "@/lib/api/writes/staffAdmin"
import { focusFirstProblem, focusIfLost } from "@/lib/focus"
import type { GuardedResult, useGuardedWrite } from "@/hooks/useGuardedWrite"
import type { StaffData } from "@/features/staff-management/staffData"
import type { StaffMemberDto } from "@/lib/api/dto/staffAdmin"
import type { ApiError } from "@/lib/api/errors"
import type { StaffScope } from "@/types/auth"

/** Where focus goes when the button that opened a dialog is gone. */
export const STAFF_FOCUS_ID = "staff-focus"

/** What every staff dialog is given. */
export interface StaffDialogProps {
  pending: boolean
  run: ReturnType<typeof useGuardedWrite<StaffData>>["run"]
  pageExplains: () => boolean
  onClose: () => void
  /** Sign out, to sign in again. Nothing is kept or sent afterwards. */
  onSignInAgain: () => void
}

function useRefusal() {
  const [refusal, setRefusal] = useState<{ error: ApiError } | null>(null)
  const stale = refusal !== null && needsRecentSignIn(refusal.error)
  return {
    refusal,
    needsSignIn: stale,
    clear: () => setRefusal(null),
    keep: (result: GuardedResult | null) => {
      if (result && "kept" in result) setRefusal({ error: result.kept })
    },
  }
}

/** The message that keeps a dialog open: sign in again, or what the server refused. */
function Refused({ refusal, onSignInAgain }: { refusal: { error: ApiError } | null; onSignInAgain: () => void }) {
  if (!refusal) return null
  if (needsRecentSignIn(refusal.error)) {
    return (
      <AttentionRegion signal={refusal}>
        <div role="alert" className="flex flex-col gap-2 rounded-xl bg-warning/10 p-3 ring-1 ring-warning/35">
          <Typography variant="label">Sign in again to manage staff</Typography>
          <Typography variant="body-sm">
            Nothing was changed. A staff change needs a recent sign-in. You'll be signed out and brought back here after
            signing in. Nothing is sent by itself: check the person's access and confirm again.
          </Typography>
          <Button type="button" className="h-11 self-start" onClick={onSignInAgain}>
            <KeyRound aria-hidden="true" />
            Sign out and sign in again
          </Button>
        </div>
      </AttentionRegion>
    )
  }
  const copy = staffAdminRefusal(refusal.error)
  return (
    <AttentionRegion signal={refusal}>
      <FormAlert title={copy.title} description={copy.description} />
    </AttentionRegion>
  )
}

function closeFocus(pageExplains: () => boolean) {
  return (event: Event) => {
    if (pageExplains()) event.preventDefault()
    else focusIfLost(STAFF_FOCUS_ID)
  }
}

interface ScopePickerProps {
  id: string
  value: StaffScope[]
  onChange: (scopes: StaffScope[]) => void
  error?: string
}

/** Every scope is chosen by hand; none is added by another. */
function ScopePicker({ id, value, onChange, error }: ScopePickerProps) {
  return (
    <fieldset id={id} tabIndex={-1} className="flex min-w-0 flex-col gap-2" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-1.5 text-sm font-medium">Scopes</legend>
      {ASSIGNABLE_SCOPES.map((scope) => (
        <CheckField
          key={scope}
          id={`${id}-${scope}`}
          label={SCOPE_INFO[scope].label}
          hint={`${SCOPE_INFO[scope].covers}${SCOPE_INFO[scope].hasScreen ? "" : " No moderator screen in this app yet."}`}
          checked={value.includes(scope)}
          onChange={(checked) =>
            onChange(
              checked ? ASSIGNABLE_SCOPES.filter((s) => s === scope || value.includes(s)) : value.filter((s) => s !== scope)
            )
          }
        />
      ))}
      <FieldError id={`${id}-error`} message={error} />
    </fieldset>
  )
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <ul aria-label="What this means" className="flex list-disc flex-col gap-1 pl-5 text-sm">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  )
}

const SESSIONS_END = "All of their sessions end. They have to sign in again."
const ORDERS_STAY =
  "Grocery orders they have claimed stay assigned to them, and nobody else can claim those. Release them from the grocery queue."

function AppointDialog({ pending, run, pageExplains, onClose, onSignInAgain, onAppointed }: StaffDialogProps & {
  onAppointed: (member: StaffMemberDto) => void
}) {
  const id = useId()
  const [step, setStep] = useState<"details" | "review">("details")
  const [email, setEmail] = useState("")
  const [scopes, setScopes] = useState<StaffScope[]>([])
  const [checked, setChecked] = useState(false)
  const [problems, setProblems] = useState<{ email?: string; scopes?: string; checked?: string }>({})
  const refused = useRefusal()
  const address = email.trim()

  async function submit() {
    if (step === "details") {
      const found = {
        email: /^[^\s@]+@[^\s@]+$/.test(address) && address.length <= 320 ? undefined : "Enter the account's email address.",
        scopes: scopes.length ? undefined : "Choose at least one scope.",
      }
      setProblems(found)
      if (found.email || found.scopes) return focusFirstProblem(id, ["email", "scopes"], found)
      refused.clear()
      setStep("review")
      return
    }
    if (!checked) {
      setProblems({ checked: "Check the address, then tick this." })
      return focusFirstProblem(id, ["checked"], { checked: "missing" })
    }
    refused.clear()
    refused.keep(await run("the appointment", (signal) => appointModerator(address, scopes, signal), onAppointed))
  }

  return (
    <ConfirmDialog
      title={step === "details" ? "Appoint a moderator" : "Check before appointing"}
      description={
        step === "details"
          ? "The person needs their own account with a verified email. There is no account search: type their address exactly. Super Admins can't be appointed or changed here."
          : "Nothing changes until the server confirms it."
      }
      submitLabel={step === "details" ? "Review" : "Appoint moderator"}
      pendingLabel="Appointing…"
      pending={pending}
      blocked={refused.needsSignIn}
      onClose={onClose}
      onSubmit={() => void submit()}
      onCloseAutoFocus={closeFocus(pageExplains)}
      alert={<Refused refusal={refused.refusal} onSignInAgain={onSignInAgain} />}
    >
      {step === "details" ? (
        <>
          <GroceryField id={`${id}-email`} label="Account email" error={problems.email}>
            <Input
              id={`${id}-email`}
              type="email"
              inputMode="email"
              // Not the Super Admin's own address: the browser must not fill this in.
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={groceryInputClass}
              aria-invalid={problems.email ? true : undefined}
              aria-describedby={describedBy(`${id}-email`, problems.email)}
            />
          </GroceryField>
          <ScopePicker id={`${id}-scopes`} value={scopes} onChange={setScopes} error={problems.scopes} />
        </>
      ) : (
        <>
          <dl className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Account</dt>
              <dd className="break-all font-semibold">{address}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Becomes</dt>
              <dd className="font-semibold">Moderator for: {scopeNames(scopes)}</dd>
            </div>
          </dl>
          <Notes
            notes={[
              SESSIONS_END,
              "They get only the scopes listed: no other admin pages.",
              ...(scopes.some((s) => !SCOPE_INFO[s].hasScreen) ? ["Listing scopes have no moderator screen in this app yet."] : []),
            ]}
          />
          <Button
            type="button"
            variant="link"
            className="h-11 self-start px-0"
            disabled={pending}
            onClick={() => {
              refused.clear()
              setChecked(false)
              setProblems({})
              setStep("details")
            }}
          >
            Change the details
          </Button>
          <CheckField
            id={`${id}-checked`}
            label="I've checked that this is the right person's address."
            checked={checked}
            onChange={setChecked}
            error={checked ? undefined : problems.checked}
          />
        </>
      )}
    </ConfirmDialog>
  )
}

export type MemberAction = "scopes" | "resume" | "pause" | "remove"

interface MemberDialogProps extends StaffDialogProps {
  action: MemberAction
  /** The person as shown now (`null`: no longer staff). */
  current: StaffMemberDto | null
  /** The person as they were when the dialog was opened: the change is decided on this. */
  opened: StaffMemberDto
  onSaved: (member: StaffMemberDto | null) => void
}

const TITLE: Record<MemberAction, { title: string; submit: string; pending: string; what: string }> = {
  scopes: { title: "Change scopes", submit: "Save scopes", pending: "Saving…", what: "the scope change" },
  resume: { title: "Resume moderator", submit: "Resume", pending: "Resuming…", what: "the resume" },
  pause: { title: "Pause moderator", submit: "Pause moderator", pending: "Pausing…", what: "the pause" },
  remove: { title: "Remove moderator", submit: "Remove moderator", pending: "Removing…", what: "the removal" },
}

function MemberDialog({ action, current, opened, pending, run, pageExplains, onClose, onSignInAgain, onSaved }: MemberDialogProps) {
  const id = useId()
  // Changing scopes starts from what they have; resuming starts from nothing.
  const [scopes, setScopes] = useState<StaffScope[]>(action === "scopes" ? opened.scopes : [])
  const [confirmed, setConfirmed] = useState(false)
  const [missing, setMissing] = useState(false)
  const refused = useRefusal()
  const meta = TITLE[action]
  const picks = action === "scopes" || action === "resume"
  const added = scopes.filter((s) => !opened.scopes.includes(s))
  const removed = opened.scopes.filter((s) => !scopes.includes(s))
  const unchanged = action === "scopes" && added.length === 0 && removed.length === 0
  const empty = picks && scopes.length === 0
  const outdated = !current || !sameAccess(current, opened)

  const notes = [SESSIONS_END]
  if (action === "pause") notes.unshift("They keep the moderator role but lose every scope: no staff access until resumed.")
  if (action === "remove") notes.unshift("The moderator role and every scope are removed. Their account is not deleted.")
  const losesGrocery =
    opened.scopes.includes("grocery") && (action === "pause" || action === "remove" || removed.includes("grocery"))
  if (losesGrocery) notes.push(ORDERS_STAY)

  async function submit() {
    if (action === "remove" && !confirmed) {
      setMissing(true)
      return focusFirstProblem(id, ["confirm"], { confirm: "missing" })
    }
    refused.clear()
    const userId = opened.userId
    const send = async (signal: AbortSignal): Promise<StaffMemberDto | null> => {
      await assertUnchanged(opened, signal)
      if (action === "scopes") return replaceModeratorScopes(userId, scopes, signal)
      if (action === "resume") return resumeModerator(userId, scopes, signal)
      if (action === "pause") return pauseModerator(userId, signal)
      await removeModerator(userId, signal)
      return null
    }
    refused.keep(await run(meta.what, send, onSaved))
  }

  return (
    <ConfirmDialog
      title={meta.title}
      description={
        <>
          <span className="block font-semibold text-foreground">{opened.displayName}</span>
          <span className="block break-all">{opened.email}</span>
        </>
      }
      submitLabel={meta.submit}
      pendingLabel={meta.pending}
      destructive={action === "remove"}
      pending={pending}
      blocked={outdated || unchanged || empty || refused.needsSignIn}
      onClose={onClose}
      onSubmit={() => void submit()}
      onCloseAutoFocus={closeFocus(pageExplains)}
      alert={
        <>
          {outdated && !pending && (
            <FormAlert
              tone="warning"
              title="This person's access changed while this was open"
              description="Close it and check their current access."
            />
          )}
          {!outdated && <Refused refusal={refused.refusal} onSignInAgain={onSignInAgain} />}
        </>
      }
    >
      {picks && <ScopePicker id={`${id}-scopes`} value={scopes} onChange={setScopes} />}
      <dl className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Now</dt>
          <dd className="font-medium">{opened.paused ? "Paused (no scopes)" : `Scopes: ${scopeNames(opened.scopes)}`}</dd>
        </div>
        <div role="status">
          <dt className="text-muted-foreground">After this change</dt>
          <dd className="font-semibold">
            {action === "remove"
              ? "Not staff"
              : action === "pause"
                ? "Paused (no scopes)"
                : empty
                  ? "Choose at least one scope. To remove every scope, pause instead."
                  : unchanged
                    ? "No change yet"
                    : `Scopes: ${scopeNames(scopes)}`}
          </dd>
          {action === "scopes" && !unchanged && !empty && (
            <dd className="mt-1">
              {added.length > 0 && <span className="block">Adds: {scopeNames(added)}</span>}
              {removed.length > 0 && <span className="block">Removes: {scopeNames(removed)}</span>}
            </dd>
          )}
        </div>
      </dl>
      <Notes notes={notes} />
      {action === "remove" && (
        <CheckField
          id={`${id}-confirm`}
          label={`Yes, remove ${opened.displayName} as a moderator.`}
          checked={confirmed}
          onChange={setConfirmed}
          error={missing && !confirmed ? "Confirm the removal." : undefined}
        />
      )}
    </ConfirmDialog>
  )
}

export { AppointDialog, MemberDialog }

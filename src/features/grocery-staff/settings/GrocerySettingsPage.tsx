import { useCallback, useId, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Settings2 } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { StatusBadge } from "@/components/feedback/StatusBadge"
import { CheckField } from "@/components/forms/CheckField"
import { ConfirmDialog } from "@/components/forms/ConfirmDialog"
import { FormAlert } from "@/components/forms/FormAlert"
import { PageHeader } from "@/components/workspace/PageHeader"
import { RefreshBar } from "@/components/workspace/RefreshBar"
import { AttentionRegion } from "@/features/grocery/AttentionRegion"
import { formatStamp } from "@/features/grocery/format"
import { useRefreshableRead } from "@/features/grocery/useRefreshableRead"
import {
  AvailabilitySection,
  CapacitySection,
  CoverageSection,
  FinancialSection,
  ScheduleSection,
  type SectionProps,
} from "@/features/grocery-staff/settings/SettingsSections"
import {
  FIELD_LABEL,
  changedFields,
  consequences,
  describeDraft,
  describeValue,
  draftOf,
  parseDraft,
  patchOf,
  rebase,
  type SettingsDraft,
} from "@/features/grocery-staff/settings/settingsForm"
import { isStaleSettings, settingsRefusal } from "@/features/grocery-staff/settings/settingsErrors"
import { mustForget } from "@/features/grocery-staff/staffErrors"
import { useGuardedWrite, type GuardedResult } from "@/hooks/useGuardedWrite"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { useToast } from "@/hooks/useToast"
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning"
import { useReportRefusedRead, useVerifiedReload } from "@/hooks/useVerifiedReload"
import { checkedSettings, fetchGrocerySettings } from "@/lib/api/reads/grocerySettings"
import { updateGrocerySettings } from "@/lib/api/writes/grocerySettings"
import { focusFirstProblem, focusIfLost } from "@/lib/focus"
import { isSuperAdmin } from "@/lib/staffAccess"
import { routes } from "@/config/routes"
import type { ApiError } from "@/lib/api/errors"
import type { GrocerySettingsDto, GrocerySettingsPatchDto } from "@/lib/api/dto/grocerySettings"
import type { CurrentUser } from "@/types/auth"

const SAVE_BUTTON_ID = "grocery-settings-review"

/** Unsaved edits, and the saved version they were made from. */
interface Edit {
  base: GrocerySettingsDto
  draft: SettingsDraft
}

/** A refused read that means this account may not see settings any more. */
function lostSettingsAccess(error: ApiError): boolean {
  return error.status === 403
}

/** Who and when, only as far as the server recorded it. */
function recordedLine(settings: GrocerySettingsDto): string {
  const when = formatStamp(settings.updatedAt)
  if (!settings.updatedBy) return `Version ${settings.revision}, saved ${when}. No person is recorded for this version.`
  return `Version ${settings.revision}, saved ${when} by ${settings.updatedBy.displayName ?? "an account whose name is not available"}.`
}

function SavedSummary({ settings }: { settings: GrocerySettingsDto }) {
  return (
    <section aria-labelledby="settings-saved" className="glass-panel flex flex-col gap-2 rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Typography as="h2" id="settings-saved" variant="h3" className="text-lg">
          Saved now
        </Typography>
        <StatusBadge
          tone={settings.enabled ? "success" : "neutral"}
          icon={Settings2}
          label={settings.enabled ? "Ordering is switched on" : "Ordering is switched off"}
        />
      </div>
      {settings.enabled && settings.serviceableBlocks.length === 0 && (
        <FormAlert
          tone="warning"
          role="status"
          title="No delivery block is listed"
          description="Ordering is switched on, but nobody can order."
        />
      )}
      <Typography variant="body-sm">{recordedLine(settings)}</Typography>
      <Typography variant="caption" className="text-muted-foreground">
        The server keeps every version, but its API only reads the latest one, so earlier versions can't be shown here. The
        staff audit doesn't record settings changes.
      </Typography>
    </section>
  )
}

function ReviewDialog({
  edit,
  patch,
  outdated,
  pending,
  run,
  onClose,
  onSaved,
  pageExplains,
}: {
  edit: Edit
  patch: GrocerySettingsPatchDto
  outdated: boolean
  pending: boolean
  run: ReturnType<typeof useGuardedWrite<GrocerySettingsDto>>["run"]
  onClose: () => void
  onSaved: (settings: GrocerySettingsDto) => void
  pageExplains: () => boolean
}) {
  const id = useId()
  const switching = patch.enabled !== undefined
  const [acknowledged, setAcknowledged] = useState(false)
  const [missing, setMissing] = useState(false)
  const [refusal, setRefusal] = useState<{ error: ApiError } | null>(null)
  const changes = changedFields(edit.base, edit.draft)
  const copy = refusal ? settingsRefusal(refusal.error) : null

  async function save() {
    if (switching && !acknowledged) {
      setMissing(true)
      focusFirstProblem(id, ["acknowledge"], { acknowledge: "missing" })
      return
    }
    setRefusal(null)
    const result: GuardedResult | null = await run(
      "your settings change",
      async (signal) => checkedSettings(await updateGrocerySettings(patch, signal)),
      onSaved
    )
    if (result && "kept" in result) setRefusal({ error: result.kept })
  }

  return (
    <ConfirmDialog
      title="Save these settings?"
      description={`This replaces version ${edit.base.revision} of the grocery settings. Nothing changes until the server confirms it.`}
      submitLabel="Save settings"
      pendingLabel="Saving…"
      pending={pending}
      blocked={outdated}
      onClose={onClose}
      onSubmit={() => void save()}
      onCloseAutoFocus={(event) => {
        if (pageExplains()) event.preventDefault()
        else focusIfLost("settings-saved-heading")
      }}
      alert={
        <>
          {outdated && !pending && (
            <FormAlert
              tone="warning"
              title="The settings changed while this was open"
              description="Close it and decide what to do with your edits."
            />
          )}
          {copy && !outdated && (
            <AttentionRegion signal={refusal}>
              <FormAlert title={copy.title} description={copy.description} />
            </AttentionRegion>
          )}
        </>
      }
    >
      <dl aria-label="Changes" className="flex flex-col gap-2">
        {changes.map((field) => (
          <div key={field} className="rounded-xl bg-muted/60 px-3 py-2">
            <dt className="text-sm font-medium">{FIELD_LABEL[field]}</dt>
            <dd className="break-words text-sm">
              <span className="text-muted-foreground">{describeValue(field, edit.base[field])}</span>
              <span aria-hidden="true"> → </span>
              <span className="sr-only"> changes to </span>
              <span className="font-semibold">{describeDraft(field, edit.draft)}</span>
            </dd>
          </div>
        ))}
      </dl>
      <ul aria-label="What this means" className="flex list-disc flex-col gap-1 pl-5 text-sm">
        {consequences(edit.base, patch).map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {switching && (
        <CheckField
          id={`${id}-acknowledge`}
          label={patch.enabled ? "Yes, switch grocery ordering ON." : "Yes, switch grocery ordering OFF."}
          checked={acknowledged}
          onChange={setAcknowledged}
          error={missing && !acknowledged ? "Confirm that you mean to switch ordering." : undefined}
        />
      )}
    </ConfirmDialog>
  )
}

function SettingsWorkspace({ user }: { user: CurrentUser }) {
  const id = useId()
  const { show } = useToast()
  const read = useRefreshableRead(`admin-grocery-settings:${user.id}`, fetchGrocerySettings, { forgetOn: mustForget })
  const current = read.data
  useReportRefusedRead(read.error, lostSettingsAccess)
  const reload = useVerifiedReload(user, read.refresh, isSuperAdmin)

  const [edit, setEdit] = useState<Edit | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [checked, setChecked] = useState(false)
  const [matched, setMatched] = useState(false)
  const closeDialog = useCallback(() => setReviewing(false), [])
  const write = useGuardedWrite<GrocerySettingsDto>({
    lockKey: `${user.id}:grocery-settings`,
    snapshot: current,
    reload: read.refresh,
    closeDialog,
    isBehind: isStaleSettings,
    explain: settingsRefusal,
  })

  // A newer version arrived. If it already holds everything that was edited, the edits are done with.
  const moved = Boolean(edit && current && current.revision !== edit.base.revision)
  if (edit && current && moved && changedFields(current, rebase(edit.base, edit.draft, current).draft).length === 0) {
    setEdit(null)
    setMatched(changedFields(edit.base, edit.draft).length > 0)
  }

  const blocker = useUnsavedChangesWarning(edit !== null)

  if (!current) {
    if (read.error) {
      return <ReadError error={read.error} onRetry={() => void reload()} headingLevel={1} title="Couldn't load the grocery settings" />
    }
    return (
      <div role="status" aria-label="Loading the grocery settings" className="flex flex-col gap-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  const conflict = edit !== null && moved
  const draft = edit?.draft ?? draftOf(current)
  const base = edit?.base ?? current
  const changed = edit ? changedFields(base, draft) : []
  const problems = checked && edit ? parseDraft(draft).problems : {}

  function change(patch: Partial<SettingsDraft>) {
    if (!current) return
    setMatched(false)
    setEdit((previous) => {
      const from = previous?.base ?? current
      const next = { ...(previous?.draft ?? draftOf(current)), ...patch }
      // Back to exactly what is saved: there is nothing unsaved any more.
      return JSON.stringify(next) === JSON.stringify(draftOf(from)) ? null : { base: from, draft: next }
    })
  }

  function discard() {
    setEdit(null)
    setChecked(false)
    write.clearNotice()
  }

  function review() {
    const found = parseDraft(draft).problems
    setChecked(true)
    const first = Object.keys(found)
    if (first.length) {
      focusFirstProblem(id, first, found)
      return
    }
    setReviewing(true)
  }

  const section: SectionProps = {
    id,
    draft,
    saved: base,
    changed: new Set(changed),
    problems,
    disabled: conflict || write.pending || write.locked,
    onChange: change,
  }
  const rebased = conflict && edit ? rebase(edit.base, edit.draft, current) : null
  const notice = write.notice

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={Settings2}
        eyebrow="Super Admin"
        title="Grocery settings"
        description="When and where customers can send orders, and the limits that apply."
        meta={
          <RefreshBar
            receivedAt={read.receivedAt}
            refreshing={read.refreshing}
            failed={Boolean(read.error)}
            onRefresh={() => void reload()}
          />
        }
      />

      {notice && (
        <AttentionRegion signal={`${notice.title}|${notice.description}`}>
          <FormAlert
            tone="warning"
            title={notice.title}
            description={notice.description}
            action={
              write.locked && !read.refreshing ? (
                <Button type="button" variant="outline" className="h-11" onClick={() => void reload()}>
                  Load the settings again
                </Button>
              ) : undefined
            }
          />
        </AttentionRegion>
      )}
      {matched && (
        <FormAlert tone="info" role="status" title="Nothing is left unsaved" description="The saved settings now match what you entered." />
      )}

      <div id="settings-saved-heading" tabIndex={-1} className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <SavedSummary settings={current} />
      </div>

      {conflict && edit && rebased && (
        <section
          aria-labelledby="settings-conflict"
          className="flex flex-col gap-3 rounded-2xl bg-warning/10 p-4 ring-1 ring-warning/35 sm:p-5"
        >
          <Typography as="h2" id="settings-conflict" variant="h3" className="text-lg">
            Version {current.revision} was saved while you were editing version {edit.base.revision}
          </Typography>
          <div>
            <Typography variant="label">Changed on the server</Typography>
            <ul className="list-disc pl-5 text-sm">
              {changedFields(edit.base, draftOf(current)).map((field) => (
                <li key={field} className="break-words">
                  {FIELD_LABEL[field]}: {describeValue(field, edit.base[field])} → {describeValue(field, current[field])}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Typography variant="label">Your unsaved edits</Typography>
            <ul className="list-disc pl-5 text-sm">
              {changed.map((field) => (
                <li key={field} className="break-words">
                  {FIELD_LABEL[field]}: {describeDraft(field, edit.draft)}
                  {rebased.clashes.includes(field) && (
                    <span className="font-semibold"> (also changed on the server: keeping yours would replace it)</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <Typography variant="body-sm">Nothing is saved until you choose, review and confirm again.</Typography>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-auto min-h-11 whitespace-normal py-2"
              onClick={() => {
                setEdit({ base: current, draft: rebased.draft })
                write.clearNotice()
              }}
            >
              Keep my edits on version {current.revision}
            </Button>
            <Button type="button" variant="outline" className="h-11" onClick={discard}>
              Discard my edits
            </Button>
          </div>
        </section>
      )}

      <form
        aria-label="Grocery settings"
        noValidate
        onSubmit={(event) => event.preventDefault()}
        className="flex flex-col gap-4"
      >
        <AvailabilitySection {...section} />
        <CoverageSection {...section} />
        <ScheduleSection {...section} />
        <CapacitySection {...section} />
        <FinancialSection {...section} />
      </form>

      {edit && !conflict && (
        <section
          aria-label="Unsaved changes"
          className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-elevated"
        >
          <Typography variant="label" role="status">
            {changed.length === 1 ? "1 unsaved change" : `${changed.length} unsaved changes`}
          </Typography>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={discard} disabled={write.pending}>
              Discard
            </Button>
            <Button
              id={SAVE_BUTTON_ID}
              type="button"
              className="h-11"
              onClick={review}
              disabled={changed.length === 0 || write.pending || write.locked}
            >
              Review changes
            </Button>
          </div>
        </section>
      )}

      {reviewing && edit && (
        <ReviewDialog
          edit={edit}
          patch={patchOf(edit.base, edit.draft)}
          outdated={conflict}
          pending={write.pending}
          run={write.run}
          onClose={closeDialog}
          onSaved={(saved) => {
            read.replace(saved)
            setEdit(null)
            setChecked(false)
            show(`Settings saved. Version ${saved.revision}.`)
          }}
          pageExplains={write.pageExplains}
        />
      )}

      {blocker.state === "blocked" && (
        <ConfirmDialog
          title="Leave without saving?"
          description="Your unsaved settings edits will be lost."
          submitLabel="Discard and leave"
          pendingLabel="Leaving…"
          backLabel="Stay here"
          destructive
          pending={false}
          onClose={() => blocker.reset()}
          onSubmit={() => blocker.proceed()}
        />
      )}
    </div>
  )
}

/** Grocery operating settings (GROCERY-3C). Super Admin only: the admin gate, and the API. */
function GrocerySettingsPage() {
  const admin = useRequireAdminAuth()
  if (!admin) return null
  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Link to={routes.adminGrocery} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-primary">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Grocery queue
        </Link>
        {/* Keyed by account: nothing loaded or typed by one is ever shown to another. */}
        <SettingsWorkspace key={admin.id} user={admin} />
      </div>
    </Container>
  )
}

export { GrocerySettingsPage }

import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronRight, History as HistoryIcon, KeyRound, UserPlus, Users } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { FormAlert } from "@/components/forms/FormAlert"
import { PageHeader } from "@/components/workspace/PageHeader"
import { RefreshBar } from "@/components/workspace/RefreshBar"
import { AttentionRegion } from "@/features/grocery/AttentionRegion"
import { useRefreshableRead } from "@/features/grocery/useRefreshableRead"
import { mustForgetRead } from "@/lib/api/errors"
import { logoutErrorMessage } from "@/features/auth/authMessages"
import { MemberBadges } from "@/features/staff-management/MemberBadges"
import { MemberPanel } from "@/features/staff-management/MemberPanel"
import { AppointDialog, MemberDialog, STAFF_FOCUS_ID, type MemberAction } from "@/features/staff-management/StaffDialogs"
import { isBehindStaff, staffAdminRefusal } from "@/features/staff-management/staffAdminErrors"
import { ROSTER_PAGE, loadStaffData, type StaffData } from "@/features/staff-management/staffData"
import { accessSummary } from "@/features/staff-management/staffLabels"
import { useAuth } from "@/hooks/useAuth"
import { useGuardedWrite } from "@/hooks/useGuardedWrite"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { useToast } from "@/hooks/useToast"
import { useReportRefusedRead, useVerifiedReload } from "@/hooks/useVerifiedReload"
import { isSuperAdmin } from "@/lib/staffAccess"
import { routes } from "@/config/routes"
import type { ApiError } from "@/lib/api/errors"
import type { StaffMemberDto } from "@/lib/api/dto/staffAdmin"
import type { CurrentUser } from "@/types/auth"

function lostStaffAccess(error: ApiError): boolean {
  return error.status === 403
}

type OpenDialog = { kind: "appoint" } | { kind: "member"; action: MemberAction; opened: StaffMemberDto }

function RosterRow({ member, viewerId, onOpen }: { member: StaffMemberDto; viewerId: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-panel flex w-full min-w-0 items-center gap-3 rounded-2xl p-4 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="break-words text-base font-medium">{member.displayName}</span>
        <span className="break-all text-sm text-muted-foreground">{member.email}</span>
        <MemberBadges member={member} viewerId={viewerId} />
        <span className="text-sm">{accessSummary(member)}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

function StaffWorkspace({ user }: { user: CurrentUser }) {
  const { logout } = useAuth()
  const { show } = useToast()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)

  const read = useRefreshableRead<StaffData>(
    `admin-staff:${user.id}:${page}:${selected ?? ""}`,
    (signal) => loadStaffData((page - 1) * ROSTER_PAGE, selected, signal),
    { forgetOn: mustForgetRead }
  )
  const data = read.data
  useReportRefusedRead(read.error, lostStaffAccess)

  // Moving between the list and a person swaps the view for a placeholder while it loads, which would
  // drop keyboard focus: put it on the new view's heading once that view is here.
  const focusNextView = useRef(false)
  const showMember = (userId: string | null) => {
    focusNextView.current = true
    setSelected(userId)
  }
  useEffect(() => {
    if (!data || !focusNextView.current) return
    focusNextView.current = false
    // After any closing dialog has finished with focus.
    setTimeout(() => document.getElementById(STAFF_FOCUS_ID)?.focus(), 0)
  }, [data])

  const { refresh } = read
  const reload = useCallback(() => {
    refresh()
    setHistoryVersion((version) => version + 1)
  }, [refresh])
  const verifiedReload = useVerifiedReload(user, reload, isSuperAdmin)

  const closeDialog = useCallback(() => setDialog(null), [])
  const write = useGuardedWrite<StaffData>({
    lockKey: `${user.id}:staff-management`,
    snapshot: data,
    reload,
    closeDialog,
    isBehind: isBehindStaff,
    explain: staffAdminRefusal,
  })

  // Signing out is how a fresh sign-in is made: the gate then sends the visitor to the staff sign-in,
  // which brings them back here. Nothing about the intended change is carried over or sent.
  const signInAgain = useCallback(() => {
    logout().catch((cause: unknown) =>
      show(logoutErrorMessage(cause, "Couldn't sign out. Check your connection and try again."), { tone: "error" })
    )
  }, [logout, show])

  const dialogProps = {
    pending: write.pending,
    run: write.run,
    pageExplains: write.pageExplains,
    onClose: closeDialog,
    onSignInAgain: signInAgain,
  }
  const notice = write.notice
  const busy = write.pending || write.locked

  const first = (page - 1) * ROSTER_PAGE + 1
  const last = data ? first + data.roster.items.length - 1 : 0

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={Users}
        eyebrow="Super Admin"
        title="Staff"
        description="Who works as portal staff, and what each moderator may do."
        meta={
          <div className="flex flex-col gap-3">
            {/* Under the text, not beside it: beside it two buttons squeeze the title to nothing on a phone. */}
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="h-11" onClick={() => setDialog({ kind: "appoint" })} disabled={busy || !data}>
                <UserPlus aria-hidden="true" />
                Appoint moderator
              </Button>
              <Button asChild variant="outline" className="h-11">
                <Link to={routes.adminStaffHistory}>
                  <HistoryIcon aria-hidden="true" />
                  Staff history
                </Link>
              </Button>
            </div>
            <RefreshBar
              receivedAt={read.receivedAt}
              refreshing={read.refreshing}
              failed={Boolean(read.error && data)}
              onRefresh={() => void verifiedReload()}
            />
          </div>
        }
      />

      <div className="flex flex-col gap-2 rounded-2xl bg-info/10 p-3 ring-1 ring-info/25 sm:flex-row sm:items-center sm:justify-between">
        <Typography variant="body-sm">
          Changing staff needs a recent sign-in (by default, within the last 15 minutes). Looking doesn't. If yours is older,
          sign in again before you start.
        </Typography>
        <Button type="button" variant="outline" className="h-11 shrink-0" onClick={signInAgain} disabled={write.pending}>
          <KeyRound aria-hidden="true" />
          Sign in again
        </Button>
      </div>

      {notice && (
        <AttentionRegion signal={`${notice.title}|${notice.description}`}>
          <FormAlert
            tone="warning"
            title={notice.title}
            description={notice.description}
            action={
              write.locked && !read.refreshing ? (
                <Button type="button" variant="outline" className="h-11" onClick={() => void verifiedReload()}>
                  Load staff records again
                </Button>
              ) : undefined
            }
          />
        </AttentionRegion>
      )}

      {!data ? (
        read.error ? (
          <ReadError error={read.error} onRetry={() => void verifiedReload()} headingLevel={2} title="Couldn't load the staff list" />
        ) : (
          <div role="status" aria-label="Loading staff records" className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-2xl" />
            ))}
          </div>
        )
      ) : selected ? (
        data.member ? (
          <MemberPanel
            viewerId={user.id}
            member={data.member}
            disabled={busy}
            historyVersion={historyVersion}
            onBack={() => showMember(null)}
            onAction={(action) => setDialog({ kind: "member", action, opened: data.member! })}
          />
        ) : (
          <div className="flex flex-col items-start gap-3">
            <Typography id={STAFF_FOCUS_ID} tabIndex={-1} variant="body">
              This person is no longer staff.
            </Typography>
            <Button type="button" variant="outline" className="h-11" onClick={() => showMember(null)}>
              All staff
            </Button>
          </div>
        )
      ) : (
        <section aria-labelledby={STAFF_FOCUS_ID} className="flex flex-col gap-3">
          <Typography
            as="h2"
            id={STAFF_FOCUS_ID}
            tabIndex={-1}
            variant="h3"
            className="rounded-md text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Staff list
          </Typography>
          <ul aria-label="Staff" className="flex flex-col gap-2">
            {data.roster.items.map((member) => (
              <li key={member.userId}>
                <RosterRow member={member} viewerId={user.id} onOpen={() => showMember(member.userId)} />
              </li>
            ))}
          </ul>
          {data.roster.items.every((member) => member.role !== "moderator") && page === 1 && data.roster.meta.total <= ROSTER_PAGE && (
            <Typography variant="body-sm" className="rounded-xl bg-muted/60 p-3">
              There are no moderators yet.
            </Typography>
          )}
          <nav aria-label="Staff pages" className="flex flex-wrap items-center justify-between gap-3">
            <Typography variant="body-sm" role="status" className="text-muted-foreground">
              {data.roster.items.length ? `Showing ${first}–${last} of ${data.roster.meta.total}` : "Nothing on this page."}
            </Typography>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-11" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={last >= data.roster.meta.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </nav>
        </section>
      )}

      {dialog?.kind === "appoint" && (
        <AppointDialog
          {...dialogProps}
          onAppointed={(member) => {
            show(`${member.displayName} is now a moderator.`)
            showMember(member.userId)
          }}
        />
      )}
      {dialog?.kind === "member" && data && (
        <MemberDialog
          {...dialogProps}
          key={dialog.action}
          action={dialog.action}
          opened={dialog.opened}
          current={data.member}
          onSaved={(member) => {
            if (member) {
              // The server's answer is the record as it now is; it is read again right after.
              read.replace({ roster: data.roster, member })
              show("Staff access saved.")
            } else {
              show(`${dialog.opened.displayName} is no longer a moderator.`)
              showMember(null)
            }
          }}
        />
      )}
    </div>
  )
}

/** Portal staff management (GROCERY-3C). Super Admin only: the admin gate, and the API. */
function StaffManagementPage() {
  const admin = useRequireAdminAuth()
  if (!admin) return null
  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        {/* Keyed by account: nothing loaded or typed by one is ever shown to another. */}
        <StaffWorkspace key={admin.id} user={admin} />
      </div>
    </Container>
  )
}

export { StaffManagementPage }

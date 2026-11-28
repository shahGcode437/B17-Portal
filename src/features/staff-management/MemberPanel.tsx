import { Link } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Typography } from "@/components/foundation/Typography"
import { ReadError } from "@/components/feedback/ReadError"
import { useRefreshableRead } from "@/features/grocery/useRefreshableRead"
import { formatStamp } from "@/features/grocery/format"
import { mustForgetRead } from "@/lib/api/errors"
import { AuditList } from "@/features/staff-management/AuditList"
import { MemberBadges } from "@/features/staff-management/MemberBadges"
import { STAFF_FOCUS_ID, type MemberAction } from "@/features/staff-management/StaffDialogs"
import { SCOPE_INFO, accessSummary, roleName } from "@/features/staff-management/staffLabels"
import { fetchStaffAudit } from "@/lib/api/reads/staffAdmin"
import { adminGroceryQueueHeldByPath } from "@/config/routes"
import type { StaffMemberDto } from "@/lib/api/dto/staffAdmin"

const HISTORY = 10

interface MemberPanelProps {
  viewerId: string
  member: StaffMemberDto
  /** A change is on its way, or its outcome is unknown. */
  disabled: boolean
  /** Bumped when the staff records are reloaded, so the history is read again too. */
  historyVersion: number
  onBack: () => void
  onAction: (action: MemberAction) => void
}

function History({ viewerId, userId, version }: { viewerId: string; userId: string; version: number }) {
  const read = useRefreshableRead(
    `admin-staff-member-audit:${viewerId}:${userId}:${version}`,
    (signal) => fetchStaffAudit({ target: userId, limit: HISTORY }, signal),
    { forgetOn: mustForgetRead }
  )
  return (
    <section aria-labelledby="member-history" className="glass-panel flex flex-col gap-3 rounded-2xl p-4 sm:p-5">
      <Typography as="h3" id="member-history" variant="h3" className="text-lg">
        Recorded changes
      </Typography>
      {!read.data ? (
        read.error ? (
          <ReadError error={read.error} onRetry={read.refresh} headingLevel={3} title="Couldn't load this history" />
        ) : (
          <div role="status" aria-label="Loading the history">
            <Skeleton className="h-20 rounded-xl" />
          </div>
        )
      ) : read.data.items.length === 0 ? (
        <Typography variant="body-sm" className="text-muted-foreground">
          The staff audit has no entry about this account.
        </Typography>
      ) : (
        <>
          <AuditList label="Changes to this account" entries={read.data.items} />
          {read.data.meta.total > read.data.items.length && (
            <Typography variant="caption" className="text-muted-foreground">
              Showing the latest {read.data.items.length} of {read.data.meta.total}.
            </Typography>
          )}
        </>
      )}
    </section>
  )
}

/** One staff member: who they are, what they can do now, and what can be changed. */
function MemberPanel({ viewerId, member, disabled, historyVersion, onBack, onAction }: MemberPanelProps) {
  const moderator = member.role === "moderator"
  const action = (name: MemberAction, label: string, destructive = false) => (
    <Button
      type="button"
      variant={destructive ? "destructive" : "outline"}
      className="h-11"
      disabled={disabled}
      onClick={() => onAction(name)}
    >
      {label}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="ghost" className="h-11 self-start" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
        All staff
      </Button>
      <section aria-labelledby={STAFF_FOCUS_ID} className="glass-panel flex min-w-0 flex-col gap-3 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <Typography
            as="h2"
            id={STAFF_FOCUS_ID}
            tabIndex={-1}
            variant="h3"
            className="scroll-mt-24 break-words rounded-md text-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {member.displayName}
          </Typography>
          <Typography variant="body-sm" className="break-all">
            {member.email}
          </Typography>
          <MemberBadges member={member} viewerId={viewerId} />
        </div>
        <Typography variant="body" className="font-medium">
          {accessSummary(member)}
        </Typography>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Role</dt>
          <dd>{roleName(member.role)}</dd>
          <dt className="text-muted-foreground">Account</dt>
          <dd>
            {member.accountStatus}, email {member.emailVerified ? "verified" : "not verified"}
          </dd>
          <dt className="text-muted-foreground">Role given</dt>
          <dd className="break-words">
            {formatStamp(member.grantedAt)}
            {member.grantedBy ? ` by ${member.grantedBy.displayName}` : ". No granting person is recorded."}
          </dd>
        </dl>

        {moderator && member.scopes.length > 0 && (
          <ul aria-label="Assigned scopes" className="flex flex-col gap-2">
            {member.scopes.map((scope) => (
              <li key={scope} className="rounded-xl bg-muted/60 px-3 py-2 text-sm">
                <span className="font-medium">{SCOPE_INFO[scope]?.label ?? scope}</span>
                <span className="block text-muted-foreground">
                  {SCOPE_INFO[scope]?.covers}{" "}
                  {SCOPE_INFO[scope]?.hasScreen ? "They use the grocery workspace." : "No moderator screen in this app yet."}
                </span>
              </li>
            ))}
          </ul>
        )}

        {moderator ? (
          <>
            <div role="group" aria-label="Change this moderator" className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
              {member.paused ? action("resume", "Resume") : action("scopes", "Change scopes")}
              {!member.paused && action("pause", "Pause")}
              {action("remove", "Remove moderator", true)}
            </div>
            <Link
              to={adminGroceryQueueHeldByPath(member.userId)}
              className="inline-flex min-h-11 items-center self-start text-sm font-medium text-primary"
            >
              Grocery orders assigned to this person
            </Link>
          </>
        ) : (
          <Typography variant="body-sm" className="rounded-xl bg-muted/60 p-3">
            Super Admins can't be changed here. They are added and removed only from the server's command line.
          </Typography>
        )}
      </section>
      <History viewerId={viewerId} userId={member.userId} version={historyVersion} />
    </div>
  )
}

export { MemberPanel }

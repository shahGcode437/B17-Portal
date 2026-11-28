import { useId, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, History as HistoryIcon } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { PageHeader } from "@/components/workspace/PageHeader"
import { RefreshBar } from "@/components/workspace/RefreshBar"
import { WorkspaceEmpty } from "@/components/workspace/WorkspaceEmpty"
import { GroceryField } from "@/features/grocery/GroceryField"
import { grocerySelectClass } from "@/features/grocery/fieldStyles"
import { useRefreshableRead } from "@/features/grocery/useRefreshableRead"
import { mustForgetRead } from "@/lib/api/errors"
import { AuditList } from "@/features/staff-management/AuditList"
import { AUDIT_ACTION, AUDIT_ACTIONS } from "@/features/staff-management/staffLabels"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { useReportRefusedRead, useVerifiedReload } from "@/hooks/useVerifiedReload"
import { fetchStaffAudit } from "@/lib/api/reads/staffAdmin"
import { isSuperAdmin } from "@/lib/staffAccess"
import { routes } from "@/config/routes"
import type { ApiError } from "@/lib/api/errors"
import type { StaffAuditActionDto } from "@/lib/api/dto/staffAdmin"
import type { CurrentUser } from "@/types/auth"

const PAGE = 20

function lostAuditAccess(error: ApiError): boolean {
  return error.status === 403
}

function AuditWorkspace({ user }: { user: CurrentUser }) {
  const id = useId()
  const [action, setAction] = useState<StaffAuditActionDto | "">("")
  const [page, setPage] = useState(1)
  const read = useRefreshableRead(
    `admin-staff-audit:${user.id}:${action}:${page}`,
    (signal) => fetchStaffAudit({ ...(action ? { action } : {}), limit: PAGE, offset: (page - 1) * PAGE }, signal),
    { forgetOn: mustForgetRead }
  )
  useReportRefusedRead(read.error, lostAuditAccess)
  const reload = useVerifiedReload(user, read.refresh, isSuperAdmin)
  const data = read.data
  const first = (page - 1) * PAGE + 1
  const last = data ? first + data.items.length - 1 : 0

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={HistoryIcon}
        eyebrow="Super Admin"
        title="Staff history"
        description="The server's permanent record of staff actions, newest first. Nothing in it can be edited or deleted here. Grocery settings and order changes are not part of it."
        meta={
          <RefreshBar
            receivedAt={read.receivedAt}
            refreshing={read.refreshing}
            failed={Boolean(read.error && data)}
            onRefresh={() => void reload()}
          />
        }
      />
      <GroceryField id={`${id}-action`} label="Kind of action" className="sm:max-w-xs">
        <select
          id={`${id}-action`}
          value={action}
          onChange={(event) => {
            setAction(event.target.value as StaffAuditActionDto | "")
            setPage(1)
          }}
          className={grocerySelectClass}
        >
          <option value="">All</option>
          {AUDIT_ACTIONS.map((value) => (
            <option key={value} value={value}>
              {AUDIT_ACTION[value]}
            </option>
          ))}
        </select>
      </GroceryField>

      {!data ? (
        read.error ? (
          <ReadError error={read.error} onRetry={() => void reload()} headingLevel={2} title="Couldn't load the staff history" />
        ) : (
          <div role="status" aria-label="Loading the staff history" className="flex flex-col gap-2">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        )
      ) : data.items.length === 0 ? (
        <WorkspaceEmpty icon={HistoryIcon} message={action ? "No entry of that kind." : "The staff audit has no entry yet."} />
      ) : (
        <>
          <div className="glass-panel rounded-2xl p-4 sm:p-5">
            <AuditList label="Staff history" entries={data.items} />
          </div>
          <nav aria-label="History pages" className="flex flex-wrap items-center justify-between gap-3">
            <Typography variant="body-sm" role="status" className="text-muted-foreground">
              Showing {first}–{last} of {data.meta.total}
            </Typography>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-11" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button type="button" variant="outline" className="h-11" disabled={last >= data.meta.total} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  )
}

/** The durable staff audit (GROCERY-3C). Super Admin only, read-only. */
function StaffHistoryPage() {
  const admin = useRequireAdminAuth()
  if (!admin) return null
  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Link to={routes.adminStaff} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-primary">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Staff
        </Link>
        <AuditWorkspace key={admin.id} user={admin} />
      </div>
    </Container>
  )
}

export { StaffHistoryPage }

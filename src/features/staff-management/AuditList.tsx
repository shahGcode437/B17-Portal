import { formatStamp } from "@/features/grocery/format"
import { auditActor, auditPerson, auditState, auditTitle, endedSessions } from "@/features/staff-management/staffLabels"
import type { StaffAuditEntryDto } from "@/lib/api/dto/staffAdmin"

/** The server's staff audit entries, as recorded. Read-only: nothing here can change one. */
function AuditList({ entries, label }: { entries: StaffAuditEntryDto[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col divide-y divide-border">
      {entries.map((entry) => {
        const target = auditPerson(entry.target)
        const before = auditState(entry.before)
        const after = auditState(entry.after)
        const sessions = endedSessions(entry.after)
        return (
          <li key={entry.id} className="flex min-w-0 flex-col gap-0.5 py-2.5 text-sm first:pt-0 last:pb-0">
            <span className="font-medium">{auditTitle(entry)}</span>
            {target && <span className="break-words">For: {target}</span>}
            <span className="text-muted-foreground">
              By {auditActor(entry)}, {formatStamp(entry.occurredAt)}
              {entry.source === "cli" ? " (command line)" : ""}
            </span>
            {before && <span className="break-words">Before: {before}</span>}
            {after && <span className="break-words">After: {after}</span>}
            {sessions && <span className="text-muted-foreground">{sessions}</span>}
            {entry.reason && <span className="break-words">Reason: {entry.reason}</span>}
          </li>
        )
      })}
    </ol>
  )
}

export { AuditList }

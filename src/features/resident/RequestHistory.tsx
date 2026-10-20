import { Skeleton } from "@/components/ui/skeleton"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { readErrorCopy } from "@/components/feedback/readErrorCopy"
import { useRequestDetail } from "@/hooks/useResidentReads"
import type { RequestStatus } from "@/types/resident"

const STATUS_WORDS: Record<RequestStatus, string> = {
  submitted: "Submitted",
  accepted: "Accepted",
  "in-progress": "Marked in progress",
  completed: "Completed",
  cancelled: "Cancelled",
}

const stampFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

/**
 * The request's history from `GET /requests/{id}` (Phase 12G): what happened, by whom (their ROLE
 * only - never a name or an id) and when. Fetched when a row is opened; a failure is shown in place
 * and never blocks the details above it, which already came with the list.
 */
function RequestHistory({ requestId, viewerRole }: { requestId: string; viewerRole: "requester" | "provider" }) {
  const read = useRequestDetail(requestId)

  return (
    <Stack gap={2}>
      <Typography variant="label" className="text-xs">
        History
      </Typography>
      {read.status === "loading" && (
        <div role="status" aria-label="Loading history" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      {read.status === "error" && (
        <Typography variant="body-sm" role="alert" className="text-muted-foreground">
          {readErrorCopy(read.error).title}. The history couldn't be loaded.{" "}
          {readErrorCopy(read.error).retryable && (
            <button type="button" onClick={read.retry} className="font-medium text-primary underline-offset-4 hover:underline">
              Try again
            </button>
          )}
        </Typography>
      )}
      {read.status === "success" && (
        <ol className="flex flex-col gap-1.5">
          {read.data.history.map((entry, index) => {
            const mine = entry.actorRole === viewerRole
            return (
              <li key={`${entry.toStatus}-${index}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium">{STATUS_WORDS[entry.toStatus]}</span>
                <span className="text-muted-foreground">
                  {mine ? "by you" : `by the ${entry.actorRole}`} · {stampFormatter.format(new Date(entry.at))}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Stack>
  )
}

export { RequestHistory }

import { Skeleton } from "@/components/ui/skeleton"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { readErrorCopy } from "@/components/feedback/readErrorCopy"
import { RequestTimeline } from "@/components/workspace/RequestTimeline"
import { useRequestDetail } from "@/hooks/useResidentReads"
import { isResourceNotFound } from "@/lib/api/errors"

/**
 * The request's history from `GET /requests/{id}` (Phase 12G): what happened, by whom (their ROLE
 * only - never a name or an id) and when. Fetched when a row is opened; a failure is shown in place
 * and never blocks the details above it, which already came with the list.
 *
 * VR4: rendered as a visual timeline (`RequestTimeline`), still built strictly from the real history
 * (no inferred events, no fabricated timestamps).
 */
function RequestHistory({ requestId, viewerRole }: { requestId: string; viewerRole: "requester" | "provider" }) {
  const read = useRequestDetail(requestId)

  return (
    <Stack gap={2}>
      <Typography variant="label" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
          {isResourceNotFound(read.error)
            ? "This request could not be found, so its history isn't available."
            : `${readErrorCopy(read.error).title}. The history couldn't be loaded.`}{" "}
          {readErrorCopy(read.error).retryable && (
            <button type="button" onClick={read.retry} className="font-medium text-primary underline-offset-4 hover:underline">
              Try again
            </button>
          )}
        </Typography>
      )}
      {read.status === "success" && <RequestTimeline history={read.data.history} viewerRole={viewerRole} />}
    </Stack>
  )
}

export { RequestHistory }

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { useMutation } from "@/hooks/useMutation"
import { useToast } from "@/hooks/useToast"
import { actOnRequest, type RequestAction } from "@/lib/api/writes/requests"
import { toRequestDetailView } from "@/lib/api/privateAdapters"
import { userMessageFor, isInvalidTransition } from "@/lib/api/writeErrors"
import type { RequestStatus } from "@/types/resident"

/**
 * The request-lifecycle action controls (Phase 12H).
 *
 * The role × status matrix (API_CONTRACT §10.8):
 *   provider:   submitted → Accept / Cancel; accepted → Start / Cancel; in-progress → Complete / Cancel
 *   requester:  submitted → Cancel;        accepted → Cancel
 *   requester may NOT accept, start or complete; requester may NOT cancel while in-progress.
 *
 * Terminal states (`completed`, `cancelled`) show nothing. The server is the authority: on a
 * `409 invalid_state_transition` (someone else acted first) we announce it, call `onRefresh` so the
 * parent re-reads the detail, and the available buttons update themselves.
 */
interface RequestActionsProps {
  requestId: string
  status: RequestStatus
  viewerRole: "requester" | "provider"
  /** Reload the request detail (and whatever list it was opened from). */
  onRefresh: () => void
}

function availableActions(role: "requester" | "provider", status: RequestStatus): RequestAction[] {
  if (status === "completed" || status === "cancelled") return []
  if (role === "requester") {
    if (status === "submitted" || status === "accepted") return ["cancel"]
    return []
  }
  // provider
  if (status === "submitted") return ["accept", "cancel"]
  if (status === "accepted") return ["start", "cancel"]
  if (status === "in-progress") return ["complete", "cancel"]
  return []
}

const LABELS: Record<RequestAction, string> = {
  accept: "Accept",
  start: "Start work",
  complete: "Mark complete",
  cancel: "Cancel request",
}
const BUSY: Record<RequestAction, string> = {
  accept: "Accepting…",
  start: "Starting…",
  complete: "Completing…",
  cancel: "Cancelling…",
}
const SUCCESS: Record<RequestAction, string> = {
  accept: "Request accepted",
  start: "Work started",
  complete: "Request completed",
  cancel: "Request cancelled",
}

function RequestActions({ requestId, status, viewerRole, onRefresh }: RequestActionsProps) {
  const actions = availableActions(viewerRole, status)
  const [running, setRunning] = useState<RequestAction | null>(null)
  const { show } = useToast()
  const mutation = useMutation(({ action }: { action: RequestAction }) => actOnRequest(requestId, action))

  if (actions.length === 0) return null

  const run = async (action: RequestAction) => {
    if (action === "cancel" && !window.confirm("Cancel this request? This cannot be undone.")) return
    setRunning(action)
    try {
      const dto = await mutation.mutate({ action })
      void toRequestDetailView(dto)
      show(SUCCESS[action])
      onRefresh()
    } catch (error) {
      const copy = userMessageFor(error, "request-action")
      show(copy.title)
      // On a stale state, refresh so the controls update.
      if (isInvalidTransition(error)) onRefresh()
    } finally {
      setRunning(null)
    }
  }

  return (
    <Stack gap={2}>
      <Stack direction="row" wrap gap={2}>
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={action === "cancel" ? "outline" : "default"}
            onClick={() => run(action)}
            disabled={mutation.pending || running !== null}
          >
            {running === action ? BUSY[action] : LABELS[action]}
          </Button>
        ))}
      </Stack>
      {mutation.status === "error" && (
        <Typography variant="body-sm" role="alert" className="text-destructive">
          {userMessageFor(mutation.error, "request-action").title}
        </Typography>
      )}
    </Stack>
  )
}

export { RequestActions }

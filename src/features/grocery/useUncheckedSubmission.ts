import { useGroceryDraft } from "@/features/grocery/groceryDraftStore"
import type { SubmissionMarker } from "@/features/grocery/submissionMarker"
import { useAuth } from "@/hooks/useAuth"

/** A send interrupted by a reload that THIS account has not yet checked, or `null`. */
export function useUncheckedSubmission(): { marker: SubmissionMarker; viewerId: string } | null {
  const { user } = useAuth()
  const recovery = useGroceryDraft((draft) => draft.recovery)
  return recovery && user && recovery.owner === user.id ? { marker: recovery, viewerId: user.id } : null
}

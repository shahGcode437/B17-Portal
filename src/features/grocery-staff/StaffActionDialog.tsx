import type { ReactNode } from "react"
import { ConfirmDialog } from "@/components/forms/ConfirmDialog"
import { FormAlert } from "@/components/forms/FormAlert"
import { AttentionRegion } from "@/features/grocery/AttentionRegion"
import { staffRefusalCopy } from "@/features/grocery-staff/staffErrors"
import { focusActionsIfLost } from "@/features/grocery-staff/fieldFocus"
import type { StaffFormProps } from "@/features/grocery-staff/useStaffForm"
import type { ApiError } from "@/lib/api/errors"

interface StaffActionDialogProps extends Pick<StaffFormProps, "pending" | "onClose" | "pageExplains"> {
  title: string
  description: ReactNode
  submitLabel: string
  pendingLabel: string
  destructive?: boolean
  refusal: { error: ApiError } | null
  outdated: boolean
  onSubmit: () => void
  children?: ReactNode
}

/** The shell of every grocery staff action: the shared confirmation, with the order's own messages. */
function StaffActionDialog({ refusal, outdated, pageExplains, ...shell }: StaffActionDialogProps) {
  const copy = refusal ? staffRefusalCopy(refusal.error) : null
  return (
    <ConfirmDialog
      {...shell}
      blocked={outdated}
      onCloseAutoFocus={(event) => {
        if (pageExplains()) event.preventDefault()
        else focusActionsIfLost()
      }}
      alert={
        <>
          {outdated && !shell.pending && (
            <FormAlert
              tone="warning"
              title="This order changed while this was open"
              description="Close it and check the latest version before deciding."
            />
          )}
          {copy && !outdated && (
            <AttentionRegion signal={refusal}>
              <FormAlert title={copy.title} description={copy.description} />
            </AttentionRegion>
          )}
        </>
      }
    />
  )
}

export { StaffActionDialog }

import type { FormEvent, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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

/** The shell of every staff action: a real form, one send at a time, and nothing claimed early. */
function StaffActionDialog({
  title,
  description,
  submitLabel,
  pendingLabel,
  destructive,
  refusal,
  outdated,
  pending,
  pageExplains,
  onClose,
  onSubmit,
  children,
}: StaffActionDialogProps) {
  const copy = refusal ? staffRefusalCopy(refusal.error) : null

  function handle(event: FormEvent) {
    event.preventDefault()
    if (!pending && !outdated) onSubmit()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          if (pageExplains()) event.preventDefault()
          else focusActionsIfLost()
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-8">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handle} className="flex flex-col gap-4">
          {children}
          {outdated && !pending && (
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
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose} disabled={pending}>
              Back
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} className="h-11" disabled={pending || outdated}>
              {pending ? pendingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { StaffActionDialog }

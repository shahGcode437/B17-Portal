import type { FormEvent, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface ConfirmDialogProps {
  title: string
  description: ReactNode
  submitLabel: string
  pendingLabel: string
  destructive?: boolean
  /** A request is on its way: the dialog can't be closed and nothing can be sent again. */
  pending: boolean
  /** Sending is not possible as the dialog stands (it is out of date, or there is nothing to send). */
  blocked?: boolean
  /** Explanations shown above the buttons. */
  alert?: ReactNode
  onSubmit: () => void
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
  backLabel?: string
  children?: ReactNode
}

/**
 * The shell of every consequential change: a real form (so Enter works), one send at a time, a way
 * back, and nothing claimed early.
 */
function ConfirmDialog({
  title,
  description,
  submitLabel,
  pendingLabel,
  destructive,
  pending,
  blocked = false,
  alert,
  onSubmit,
  onClose,
  onCloseAutoFocus,
  backLabel = "Back",
  children,
}: ConfirmDialogProps) {
  function handle(event: FormEvent) {
    event.preventDefault()
    if (!pending && !blocked) onSubmit()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle className="pr-8">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handle} className="flex min-w-0 flex-col gap-4">
          {children}
          {alert}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose} disabled={pending}>
              {backLabel}
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} className="h-11" disabled={pending || blocked}>
              {pending ? pendingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { ConfirmDialog }

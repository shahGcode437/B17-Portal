import {
  BadgeCheck,
  Banknote,
  CircleOff,
  CreditCard,
  Flag,
  Hand,
  PackageCheck,
  PackageX,
  ReceiptText,
  TrendingDown,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Typography } from "@/components/foundation/Typography"
import { actionNotes, assignmentLabel } from "@/features/grocery-staff/staffLabels"
import { ACTIONS_HEADING_ID } from "@/features/grocery-staff/fieldFocus"
import type { GroceryStaffActionDto, GroceryStaffOrderDetailDto } from "@/lib/api/dto/groceryStaff"

const BUTTONS: Record<GroceryStaffActionDto, { label: string; icon: LucideIcon }> = {
  claim: { label: "Claim order", icon: Hand },
  release: { label: "Release order", icon: Undo2 },
  confirm: { label: "Record agreement", icon: BadgeCheck },
  start_preparing: { label: "Start preparing", icon: PackageCheck },
  dispatch: { label: "Send out for delivery", icon: Truck },
  complete: { label: "Record delivery and cash", icon: Banknote },
  delivery_failed: { label: "Record failed delivery", icon: PackageX },
  reconfirm: { label: "Record new agreement", icon: BadgeCheck },
  reduce_amount: { label: "Lower amount due", icon: TrendingDown },
  record_payment: { label: "Record payment", icon: CreditCard },
  record_refund: { label: "Record refund", icon: ReceiptText },
  record_issue: { label: "Record issue", icon: Flag },
  cancel: { label: "Cancel order", icon: CircleOff },
}

/** The one step that moves an order forward from where it is. */
const NEXT_STEP: GroceryStaffActionDto[] = ["claim", "confirm", "start_preparing", "dispatch", "complete"]
const OTHER: GroceryStaffActionDto[] = [
  "record_payment",
  "delivery_failed",
  "reconfirm",
  "reduce_amount",
  "release",
  "record_issue",
  "record_refund",
  "cancel",
]

interface StaffActionsPanelProps {
  order: GroceryStaffOrderDetailDto
  viewerId: string
  superAdmin: boolean
  /** A change is on its way. */
  pending: boolean
  /** The last change's outcome is unknown and the order has not been loaded again. */
  locked: boolean
  onAction: (action: GroceryStaffActionDto) => void
}

/**
 * Who holds the order and what can be done now. Only what the server lists in `availableActions` is
 * offered (it decides again when asked); the sentences below say why the rest is missing.
 */
function StaffActionsPanel({ order, viewerId, superAdmin, pending, locked, onAction }: StaffActionsPanelProps) {
  const offered = new Set(order.availableActions)
  const next = NEXT_STEP.filter((action) => offered.has(action))
  const other = OTHER.filter((action) => offered.has(action))
  const disabled = pending || locked
  const notes = actionNotes(order, viewerId, superAdmin)

  function button(action: GroceryStaffActionDto, primary: boolean) {
    const { icon: Icon } = BUTTONS[action]
    const label = action === "complete" && order.payment ? "Record delivery" : BUTTONS[action].label
    return (
      <Button
        key={action}
        type="button"
        variant={action === "cancel" ? "destructive" : primary ? "default" : "outline"}
        className="h-auto min-h-11 justify-start whitespace-normal py-2 text-left"
        disabled={disabled}
        onClick={() => onAction(action)}
      >
        <Icon aria-hidden="true" />
        {action === "claim" && pending ? "Claiming…" : label}
      </Button>
    )
  }

  return (
    <section aria-labelledby={ACTIONS_HEADING_ID} className="glass-panel flex flex-col gap-3 rounded-2xl p-4 sm:p-5">
      <Typography
        as="h2"
        id={ACTIONS_HEADING_ID}
        tabIndex={-1}
        variant="h3"
        className="scroll-mt-24 rounded-md text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Actions
      </Typography>
      <Typography variant="body-sm">
        <span className="text-muted-foreground">Assignment: </span>
        <span className="font-semibold">{assignmentLabel(order.assignee, viewerId)}</span>
      </Typography>
      {notes.map((note) => (
        <Typography key={note} variant="body-sm" className="text-muted-foreground">
          {note}
        </Typography>
      ))}
      {next.length > 0 && <div className="flex flex-col gap-2">{next.map((action, index) => button(action, index === 0))}</div>}
      {other.length > 0 && (
        <div role="group" aria-label="Other actions" className="flex flex-col gap-2 border-t border-border/60 pt-3">
          {other.map((action) => button(action, false))}
        </div>
      )}
      <Typography variant="body-sm" role="status" className="text-muted-foreground">
        {pending ? "Saving… the order changes only when the server confirms it." : ""}
      </Typography>
    </section>
  )
}

export { StaffActionsPanel }

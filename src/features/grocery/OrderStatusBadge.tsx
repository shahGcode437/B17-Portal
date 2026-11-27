import { StatusBadge } from "@/components/feedback/StatusBadge"
import { STATUS_META } from "@/features/grocery/orderStatus"
import type { GroceryStatusDto } from "@/lib/api/dto/grocery"

/** A grocery order's status: icon and words, never colour alone. */
function OrderStatusBadge({ status, className }: { status: GroceryStatusDto; className?: string }) {
  const { tone, icon, label } = STATUS_META[status]
  return <StatusBadge tone={tone} icon={icon} label={label} className={className} />
}

export { OrderStatusBadge }

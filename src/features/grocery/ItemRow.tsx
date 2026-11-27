import { Pencil, Trash2 } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { SUBSTITUTION_LABEL } from "@/features/grocery/format"
import { formatAmount } from "@/features/grocery/quantity"
import type { GrocerySubstitutionDto, GroceryUnitDto } from "@/lib/api/dto/grocery"

interface ItemLineProps {
  name: string
  quantity: string
  unit: GroceryUnitDto
  preferredBrand?: string
  substitution: GrocerySubstitutionDto
  note?: string
}

/** What one grocery line says, wherever it is listed (draft, review, order details). */
function ItemDetails({ name, quantity, unit, preferredBrand, substitution, note }: ItemLineProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Typography as="span" variant="label" className="min-w-0 break-words text-base">
          {name}
        </Typography>
        <Typography as="span" variant="body-sm" className="font-semibold tabular-nums">
          {formatAmount(quantity, unit)}
        </Typography>
      </div>
      {preferredBrand && (
        <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
          Brand: {preferredBrand}
        </Typography>
      )}
      <Typography as="span" variant="body-sm" className="text-muted-foreground">
        {SUBSTITUTION_LABEL[substitution]}
      </Typography>
      {note && (
        <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
          Note: {note}
        </Typography>
      )}
    </div>
  )
}

interface ItemRowProps extends ItemLineProps {
  number: number
  onEdit: () => void
  onRemove: () => void
  disabled?: boolean
}

/** A line of the draft, with its edit and remove controls (44px targets). */
function ItemRow({ number, onEdit, onRemove, disabled, ...line }: ItemRowProps) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-semibold tabular-nums">
        {number}
      </span>
      <ItemDetails {...line} />
      <div className="flex shrink-0 gap-1">
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={`Edit ${line.name}`} onClick={onEdit} disabled={disabled}>
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 text-destructive"
          aria-label={`Remove ${line.name}`}
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}

export { ItemDetails, ItemRow }

import { useEffect, useId, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { ChevronDown, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GroceryField } from "@/features/grocery/GroceryField"
import { describedBy, groceryInputClass, grocerySelectClass } from "@/features/grocery/fieldStyles"
import { LIMITS, itemSchema, type ItemValues } from "@/features/grocery/orderRequest"
import { UNIT_LABEL, formatAmount } from "@/features/grocery/quantity"
import { SUBSTITUTION_LABEL } from "@/features/grocery/format"
import { zodResolver } from "@/lib/zodResolver"
import { cn } from "@/lib/utils"
import type { GrocerySubstitutionDto, GroceryUnitRuleDto } from "@/lib/api/dto/grocery"

function blankItem(units: GroceryUnitRuleDto[], unit?: ItemValues["unit"]): ItemValues {
  return {
    name: "",
    quantity: "",
    unit: unit ?? units[0]?.unit ?? "kg",
    preferredBrand: "",
    substitution: "ask",
    note: "",
  }
}

interface ItemFormProps {
  units: GroceryUnitRuleDto[]
  substitutionOptions: GrocerySubstitutionDto[]
  initial?: ItemValues
  submitLabel: string
  onSave: (values: ItemValues) => void
  onCancel?: () => void
  /** Tells the page whether something is typed here that has not been added yet. */
  onDirtyChange?: (dirty: boolean) => void
  autoFocus?: boolean
}

/**
 * One grocery line. Used for adding and for editing in place. Enter adds it; after adding, the form
 * clears, keeps the unit and puts the cursor back on the name, so a long list is quick to type.
 */
function ItemForm({
  units,
  substitutionOptions,
  initial,
  submitLabel,
  onSave,
  onCancel,
  onDirtyChange,
  autoFocus,
}: ItemFormProps) {
  const id = useId()
  const adding = !initial
  const [more, setMore] = useState(Boolean(initial && (initial.preferredBrand || initial.note || initial.substitution !== "ask")))
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setFocus,
    control,
    formState: { errors },
  } = useForm<ItemValues>({
    resolver: zodResolver<ItemValues>(itemSchema(units)),
    defaultValues: initial ?? blankItem(units),
    shouldFocusError: true,
  })
  // Focus returns to the name AFTER the cleared form has re-rendered; right after `reset()` it is too early.
  const [added, setAdded] = useState(0)
  useEffect(() => {
    if (added > 0) setFocus("name")
  }, [added, setFocus])
  const unit = useWatch({ control, name: "unit" })
  const rule = units.find((candidate) => candidate.unit === unit)

  function report() {
    const values = getValues()
    onDirtyChange?.(Boolean(values.name.trim() || values.quantity.trim() || values.preferredBrand.trim() || values.note.trim()))
  }

  const save = handleSubmit((values) => {
    onSave(values)
    if (adding) {
      reset(blankItem(units, values.unit))
      setMore(false)
      onDirtyChange?.(false)
      setAdded((count) => count + 1)
    }
  })

  // A field the API requires an "unknown" error for opens the panel it is in.
  const showMore = more || Boolean(errors.preferredBrand || errors.note || errors.substitution)

  return (
    <form noValidate onSubmit={(event) => void save(event)} onChange={report} className="flex flex-col gap-3">
      <GroceryField id={`${id}-name`} label="Item" error={errors.name?.message}>
        <Input
          id={`${id}-name`}
          {...register("name")}
          maxLength={LIMITS.name}
          autoComplete="off"
          enterKeyHint="next"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          placeholder="For example, Basmati rice"
          className={groceryInputClass}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy(`${id}-name`, errors.name?.message)}
        />
      </GroceryField>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <GroceryField id={`${id}-quantity`} label="Quantity" error={errors.quantity?.message}>
          <Input
            id={`${id}-quantity`}
            {...register("quantity")}
            inputMode="decimal"
            autoComplete="off"
            maxLength={12}
            placeholder="e.g. 2"
            className={groceryInputClass}
            aria-invalid={errors.quantity ? true : undefined}
            aria-describedby={describedBy(`${id}-quantity`, errors.quantity?.message, true)}
          />
        </GroceryField>
        <GroceryField id={`${id}-unit`} label="Unit" error={errors.unit?.message}>
          <select
            id={`${id}-unit`}
            {...register("unit")}
            className={grocerySelectClass}
            aria-describedby={describedBy(`${id}-unit`, errors.unit?.message)}
          >
            {units.map((option) => (
              <option key={option.unit} value={option.unit}>
                {UNIT_LABEL[option.unit]}
              </option>
            ))}
          </select>
        </GroceryField>
      </div>
      {rule && (
        <p id={`${id}-quantity-hint`} className="-mt-1.5 text-xs text-muted-foreground">
          From {formatAmount(rule.minimum, rule.unit)} to {formatAmount(rule.maximum, rule.unit)}.
        </p>
      )}

      <Button
        type="button"
        variant="ghost"
        className="h-11 justify-start px-1 text-primary"
        aria-expanded={showMore}
        aria-controls={`${id}-more`}
        onClick={() => setMore(!showMore)}
      >
        <ChevronDown className={cn("transition-transform", showMore && "rotate-180")} />
        Brand, substitutes and notes
      </Button>
      <div id={`${id}-more`} hidden={!showMore} className={cn("flex-col gap-3", showMore ? "flex" : "hidden")}>
        <GroceryField id={`${id}-brand`} label="Preferred brand" optional error={errors.preferredBrand?.message}>
          <Input
            id={`${id}-brand`}
            {...register("preferredBrand")}
            maxLength={LIMITS.brand}
            autoComplete="off"
            className={groceryInputClass}
            aria-describedby={describedBy(`${id}-brand`, errors.preferredBrand?.message)}
          />
        </GroceryField>
        <GroceryField id={`${id}-substitution`} label="If it isn't available" error={errors.substitution?.message}>
          <select id={`${id}-substitution`} {...register("substitution")} className={grocerySelectClass}>
            {substitutionOptions.map((option) => (
              <option key={option} value={option}>
                {SUBSTITUTION_LABEL[option]}
              </option>
            ))}
          </select>
        </GroceryField>
        <GroceryField id={`${id}-note`} label="Instructions for this item" optional error={errors.note?.message}>
          <Input
            id={`${id}-note`}
            {...register("note")}
            maxLength={LIMITS.itemNote}
            autoComplete="off"
            placeholder="For example, ripe but firm"
            className={groceryInputClass}
            aria-describedby={describedBy(`${id}-note`, errors.note?.message)}
          />
        </GroceryField>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant={adding ? "outline" : "default"}
          className={cn("h-11 flex-1 sm:flex-none sm:px-6", adding && "border-primary/60 text-primary")}
        >
          {adding && <Plus />}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" className="h-11" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

export { ItemForm }

import { useEffect, useRef } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  FOOD_CATEGORIES,
  FOOD_SERVICE_OPTIONS,
  MAX_FOOD_CATEGORIES,
  MAX_MENU_HIGHLIGHTS,
  foodCategoryLabel,
} from "@/config/food"
import type { FoodCategorySlug, FoodServiceOption } from "@/config/food"
import { ListingImageInput } from "@/features/provider/ListingImageInput"
import type { FoodFieldErrors, FoodFormValues, MenuHighlightFormValues } from "@/features/provider/listingSchema"
import { cn } from "@/lib/utils"

interface FoodListingFieldsProps {
  value: FoodFormValues
  onChange: (next: FoodFormValues) => void
  /** Field path -> message (see `validateFoodFields`). */
  errors: FoodFieldErrors
}

const optionClass = cn(
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2 text-sm transition-colors",
  "has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
  "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
)

interface OptionCheckboxProps {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  invalid?: boolean
  onChange: (checked: boolean) => void
}

/** A native checkbox in a bordered, 44px-tall label — the checked state is a real checkmark, not only a colour change. */
function OptionCheckbox({ id, label, checked, disabled, invalid, onChange }: OptionCheckboxProps) {
  return (
    <label htmlFor={id} className={optionClass}>
      <input
        id={id}
        type="checkbox"
        className="size-4 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <Typography id={id} variant="caption" className="text-destructive" role="alert">
      {message}
    </Typography>
  )
}

const emptyRow: MenuHighlightFormValues = { name: "", section: "", description: "", price: "" }

/**
 * The Food & Dining block of the Business listing form (FD4). Controlled by
 * `ListingForm`: the nested/array shaped values live in one `FoodFormValues`
 * object (not react-hook-form) and are validated by `validateFoodFields`.
 * Everything is config-backed — categories and service options come only from
 * `config/food.ts` — and the FIRST selected category is the primary one. The
 * menu is informational: no ordering, quantity or availability fields.
 */
function FoodListingFields({ value, onChange, errors }: FoodListingFieldsProps) {
  const { categories, serviceOptions, hoursNote, menuHighlights, menuImage } = value
  const atMaxCategories = categories.length >= MAX_FOOD_CATEGORIES
  const atMaxMenu = menuHighlights.length >= MAX_MENU_HIGHLIGHTS

  const addButtonRef = useRef<HTMLButtonElement>(null)
  // Where keyboard focus should land after the list changes: a new row's name field, or the Add button after a removal.
  const pendingFocus = useRef<{ row: number } | "add" | null>(null)

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    if (target === "add") addButtonRef.current?.focus()
    else document.getElementById(`food-mh-${target.row}-name`)?.focus()
  }, [menuHighlights.length])

  function toggleCategory(slug: FoodCategorySlug, checked: boolean) {
    onChange({
      ...value,
      categories: checked ? [...categories, slug] : categories.filter((category) => category !== slug),
    })
  }

  function makePrimary(slug: FoodCategorySlug) {
    onChange({ ...value, categories: [slug, ...categories.filter((category) => category !== slug)] })
  }

  function toggleService(option: FoodServiceOption, checked: boolean) {
    const next = checked ? [...serviceOptions, option] : serviceOptions.filter((existing) => existing !== option)
    // Stored in canonical config order so the click order never changes the listing.
    onChange({
      ...value,
      serviceOptions: FOOD_SERVICE_OPTIONS.map((o) => o.value).filter((o) => next.includes(o)),
    })
  }

  function updateRow(index: number, patch: Partial<MenuHighlightFormValues>) {
    onChange({
      ...value,
      menuHighlights: menuHighlights.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    })
  }

  function addRow() {
    if (atMaxMenu) return
    pendingFocus.current = { row: menuHighlights.length }
    onChange({ ...value, menuHighlights: [...menuHighlights, { ...emptyRow }] })
  }

  function removeRow(index: number) {
    pendingFocus.current = "add"
    onChange({ ...value, menuHighlights: menuHighlights.filter((_, i) => i !== index) })
  }

  const categoryDescribedBy = ["food-categories-hint", errors.categories && "food-categories-error"]
    .filter(Boolean)
    .join(" ")
  const serviceDescribedBy = ["food-services-hint", errors.serviceOptions && "food-services-error"]
    .filter(Boolean)
    .join(" ")

  return (
    <Stack gap={6} className="rounded-xl border border-border p-4">
      <Stack gap={1}>
        <Typography as="h2" variant="h3" className="text-lg sm:text-xl">
          Food &amp; Dining details
        </Typography>
        <Typography variant="body-sm" className="text-muted-foreground">
          Helps residents find you by what you serve. Your Business Name, description, area and cover image are above.
        </Typography>
      </Stack>

      <fieldset aria-describedby={categoryDescribedBy} className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Food categories</legend>
        <Typography id="food-categories-hint" variant="caption">
          Choose 1 to {MAX_FOOD_CATEGORIES}. The first one you choose is your primary category — it becomes your
          listing&apos;s main label.
        </Typography>
        <div className="grid gap-2 min-[420px]:grid-cols-2">
          {FOOD_CATEGORIES.map((category) => {
            const checked = categories.includes(category.slug)
            return (
              <OptionCheckbox
                key={category.slug}
                id={`food-category-${category.slug}`}
                label={category.label}
                checked={checked}
                disabled={!checked && atMaxCategories}
                invalid={!!errors.categories}
                onChange={(next) => toggleCategory(category.slug, next)}
              />
            )
          })}
        </div>
        <FieldError id="food-categories-error" message={errors.categories} />
        {categories.length > 0 && (
          <ul aria-label="Selected categories" className="flex flex-wrap gap-2">
            {categories.map((slug, index) => {
              const label = foodCategoryLabel(slug)
              return (
                <li
                  key={slug}
                  className="flex min-h-9 items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-1 text-sm"
                >
                  <span className="break-words">{label}</span>
                  {index === 0 ? (
                    <Badge variant="outline">Primary</Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Make ${label} the primary category`}
                      onClick={() => makePrimary(slug)}
                    >
                      Make primary
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </fieldset>

      <fieldset aria-describedby={serviceDescribedBy} className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Service options</legend>
        <Typography id="food-services-hint" variant="caption">
          Choose everything that applies. Delivery means delivery you arrange yourself — B-17 Portal does not provide
          delivery.
        </Typography>
        <div className="grid gap-2 sm:grid-cols-3">
          {FOOD_SERVICE_OPTIONS.map((option) => (
            <OptionCheckbox
              key={option.value}
              id={`food-service-${option.value}`}
              label={option.label}
              checked={serviceOptions.includes(option.value)}
              invalid={!!errors.serviceOptions}
              onChange={(next) => toggleService(option.value, next)}
            />
          ))}
        </div>
        <FieldError id="food-services-error" message={errors.serviceOptions} />
      </fieldset>

      <Stack gap={2}>
        <Label htmlFor="food-hours">Opening hours (optional)</Label>
        <Input
          id="food-hours"
          placeholder="e.g. Mon–Sun, 12 PM–11 PM"
          value={hoursNote}
          aria-invalid={!!errors.hoursNote}
          aria-describedby={errors.hoursNote ? "food-hours-error" : "food-hours-hint"}
          onChange={(event) => onChange({ ...value, hoursNote: event.target.value })}
        />
        {errors.hoursNote ? (
          <FieldError id="food-hours-error" message={errors.hoursNote} />
        ) : (
          <Typography id="food-hours-hint" variant="caption">
            Shown exactly as you type it.
          </Typography>
        )}
      </Stack>

      <fieldset
        aria-describedby={["food-menu-hint", errors.menuHighlights && "food-menu-error"].filter(Boolean).join(" ")}
        className="flex min-w-0 flex-col gap-3"
      >
        <legend className="mb-2 text-sm font-medium">Menu highlights (optional)</legend>
        <Typography id="food-menu-hint" variant="caption">
          A few signature items, up to {MAX_MENU_HIGHLIGHTS}. This helps residents get a feel for what you offer — it
          is not an ordering menu. Prices are shown exactly as you type them.
        </Typography>

        {menuHighlights.map((row, index) => {
          const n = index + 1
          const nameError = errors[`menuHighlights.${index}.name`]
          const sectionError = errors[`menuHighlights.${index}.section`]
          const descriptionError = errors[`menuHighlights.${index}.description`]
          const priceError = errors[`menuHighlights.${index}.price`]
          return (
            <div
              key={index}
              role="group"
              aria-labelledby={`food-mh-${index}-heading`}
              className="flex flex-col gap-3 rounded-xl border border-border p-3"
            >
              <Stack direction="row" align="center" justify="between" gap={2}>
                <Typography as="p" variant="label" id={`food-mh-${index}-heading`}>
                  Menu item {n}
                </Typography>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove menu item ${n}`}
                  onClick={() => removeRow(index)}
                >
                  <Trash2 />
                  Remove
                </Button>
              </Stack>

              <Stack gap={2}>
                <Label htmlFor={`food-mh-${index}-name`}>Item name</Label>
                <Input
                  id={`food-mh-${index}-name`}
                  placeholder="e.g. Chicken Karahi"
                  value={row.name}
                  aria-invalid={!!nameError}
                  aria-describedby={nameError ? `food-mh-${index}-name-error` : undefined}
                  onChange={(event) => updateRow(index, { name: event.target.value })}
                />
                <FieldError id={`food-mh-${index}-name-error`} message={nameError} />
              </Stack>

              <div className="grid gap-3 sm:grid-cols-2">
                <Stack gap={2}>
                  <Label htmlFor={`food-mh-${index}-section`}>Section (optional)</Label>
                  <Input
                    id={`food-mh-${index}-section`}
                    placeholder="e.g. Mains"
                    value={row.section}
                    aria-invalid={!!sectionError}
                    aria-describedby={sectionError ? `food-mh-${index}-section-error` : undefined}
                    onChange={(event) => updateRow(index, { section: event.target.value })}
                  />
                  <FieldError id={`food-mh-${index}-section-error`} message={sectionError} />
                </Stack>
                <Stack gap={2}>
                  <Label htmlFor={`food-mh-${index}-price`}>Price (optional)</Label>
                  <Input
                    id={`food-mh-${index}-price`}
                    placeholder="e.g. PKR 1,400"
                    value={row.price}
                    aria-invalid={!!priceError}
                    aria-describedby={priceError ? `food-mh-${index}-price-error` : undefined}
                    onChange={(event) => updateRow(index, { price: event.target.value })}
                  />
                  <FieldError id={`food-mh-${index}-price-error`} message={priceError} />
                </Stack>
              </div>

              <Stack gap={2}>
                <Label htmlFor={`food-mh-${index}-description`}>Description (optional)</Label>
                <Input
                  id={`food-mh-${index}-description`}
                  placeholder="e.g. Half or full, cooked to order."
                  value={row.description}
                  aria-invalid={!!descriptionError}
                  aria-describedby={descriptionError ? `food-mh-${index}-description-error` : undefined}
                  onChange={(event) => updateRow(index, { description: event.target.value })}
                />
                <FieldError id={`food-mh-${index}-description-error`} message={descriptionError} />
              </Stack>
            </div>
          )
        })}

        <FieldError id="food-menu-error" message={errors.menuHighlights} />

        <Stack direction="row" align="center" gap={3} wrap>
          <Button ref={addButtonRef} type="button" variant="outline" disabled={atMaxMenu} onClick={addRow}>
            <Plus />
            Add menu item
          </Button>
          <Typography variant="caption" aria-live="polite">
            {menuHighlights.length} of {MAX_MENU_HIGHLIGHTS} items
          </Typography>
        </Stack>
      </fieldset>

      <ListingImageInput
        id="food-menu-image"
        label="Menu Image"
        contain
        value={menuImage}
        onChange={(next) => onChange({ ...value, menuImage: next })}
      />
    </Stack>
  )
}

export { FoodListingFields }

import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import type { ListingKind } from "@/types/listing"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { zodResolver } from "@/lib/zodResolver"
import {
  listingSchema,
  validateFoodFields,
  type FoodFieldErrors,
  type FoodFormValues,
  type ListingFormFields,
  type ListingFormValues,
} from "@/features/provider/listingSchema"
import { ListingImageInput } from "@/features/provider/ListingImageInput"
import { FoodListingFields } from "@/features/provider/FoodListingFields"
import { emptyFoodFormValues } from "@/features/provider/listingBuilders"
import { selectClassName } from "@/features/provider/formStyles"
import { serviceCategories } from "@/data/serviceCategories"
import { FOOD_VERTICAL_LABEL } from "@/config/food"

interface ListingFormProps {
  kind: ListingKind
  defaultValues?: Partial<ListingFormValues>
  onSubmit: (values: ListingFormValues) => void
  onBack: () => void
}

const businessTypeChoices = [
  { value: "general", title: "General Business", description: "Shops, pharmacies, salons and other local businesses." },
  { value: "food", title: FOOD_VERTICAL_LABEL, description: "Restaurants, cafes, bakeries and other places to eat." },
] as const

/**
 * Unified listing form (UI/UX Spec §18) — same fields for both onboarding types, category input differs.
 * For a Business (FD4) a "Business type" choice switches between the General category field and the
 * Food & Dining block; the listing is a Business either way.
 */
function ListingForm({ kind, defaultValues, onSubmit, onBack }: ListingFormProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ListingFormFields>({
    resolver: zodResolver(listingSchema),
    defaultValues: {
      name: "",
      category: "",
      description: "",
      area: "",
      tagsInput: "",
      ...defaultValues,
      vertical: defaultValues?.vertical ?? "general",
    },
  })

  // Kept outside react-hook-form: the value is a browser-local object URL,
  // not something a native input can hold via register(), and the image
  // only needs to be merged in at submit time.
  const [image, setImage] = useState<string | undefined>(defaultValues?.image)

  // Food block (FD4): nested values + their own validation live outside react-hook-form (see `foodFormSchema`).
  // Kept while the type toggles, so switching General <-> Food doesn't discard what was typed.
  const isBusiness = kind === "business"
  const vertical = useWatch({ control, name: "vertical" })
  const isFood = isBusiness && vertical === "food"
  const [food, setFood] = useState<FoodFormValues>(() => defaultValues?.food ?? emptyFoodFormValues())
  const [foodErrors, setFoodErrors] = useState<FoodFieldErrors>({})

  function handleFoodChange(next: FoodFormValues) {
    setFood(next)
    // Once errors are showing, keep them live so they clear as soon as the field is fixed.
    if (Object.keys(foodErrors).length > 0) setFoodErrors(validateFoodFields(next))
  }

  const nameLabel = kind === "provider" ? "Name" : "Business Name"
  const categoryLabel = kind === "provider" ? "Service Category" : "Category"
  const tagsLabel = kind === "provider" ? "Services Offered" : isFood ? "Dishes / Search Tags" : "Services / Tags"

  function submit(values: ListingFormFields) {
    if (isFood) {
      const nextErrors = validateFoodFields(food)
      setFoodErrors(nextErrors)
      if (Object.keys(nextErrors).length > 0) {
        // Move focus to the first invalid Food control once the errors have rendered.
        setTimeout(() => document.querySelector<HTMLElement>('[data-food-fields] [aria-invalid="true"]')?.focus(), 0)
        return
      }
      onSubmit({ ...values, image, vertical: "food", food })
      return
    }
    onSubmit({ ...values, image, vertical: "general" })
  }

  // Show Food problems together with the general ones (react-hook-form focuses its own first invalid field).
  function showFoodErrors() {
    if (isFood) setFoodErrors(validateFoodFields(food))
  }

  return (
    <form onSubmit={handleSubmit(submit, showFoodErrors)} noValidate>
      <Stack gap={4}>
        {isBusiness && (
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Business type</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {businessTypeChoices.map((choice) => (
                <label
                  key={choice.value}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-input p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    value={choice.value}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    {...register("vertical")}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{choice.title}</span>
                    <span className="block text-xs text-muted-foreground">{choice.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <Stack gap={2}>
          <Label htmlFor="listing-name">{nameLabel}</Label>
          <Input
            id="listing-name"
            placeholder={
              kind === "provider"
                ? "e.g. B-17 Solar Solutions"
                : isFood
                  ? "e.g. Karahi Junction"
                  : "e.g. Capital Stationery Mart"
            }
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "listing-name-error" : undefined}
            {...register("name")}
          />
          {errors.name && (
            <Typography id="listing-name-error" variant="caption" className="text-destructive" role="alert">
              {errors.name.message}
            </Typography>
          )}
        </Stack>

        {!isFood && (
          <Stack gap={2}>
            <Label htmlFor="listing-category">{categoryLabel}</Label>
            {kind === "provider" ? (
              <select
                id="listing-category"
                className={selectClassName}
                defaultValue=""
                aria-invalid={!!errors.category}
                aria-describedby={errors.category ? "listing-category-error" : undefined}
                {...register("category")}
              >
                <option value="" disabled>
                  Choose a category
                </option>
                {serviceCategories.map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="listing-category"
                placeholder="e.g. Stationery, Grocery, Salon"
                aria-invalid={!!errors.category}
                aria-describedby={errors.category ? "listing-category-error" : undefined}
                {...register("category")}
              />
            )}
            {errors.category && (
              <Typography id="listing-category-error" variant="caption" className="text-destructive" role="alert">
                {errors.category.message}
              </Typography>
            )}
          </Stack>
        )}

        <Stack gap={2}>
          <Label htmlFor="listing-description">Description</Label>
          <Textarea
            id="listing-description"
            placeholder="What do you offer? Keep it short and clear."
            rows={3}
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? "listing-description-error" : undefined}
            {...register("description")}
          />
          {errors.description && (
            <Typography id="listing-description-error" variant="caption" className="text-destructive" role="alert">
              {errors.description.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="listing-area">Area</Label>
          <Input
            id="listing-area"
            placeholder="e.g. B-17, Block C"
            aria-invalid={!!errors.area}
            aria-describedby={errors.area ? "listing-area-error" : undefined}
            {...register("area")}
          />
          {errors.area && (
            <Typography id="listing-area-error" variant="caption" className="text-destructive" role="alert">
              {errors.area.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="listing-tags">{tagsLabel}</Label>
          <Input
            id="listing-tags"
            placeholder={isFood ? "e.g. biryani, karahi, family dining" : "e.g. solar panels, net metering, rooftop"}
            aria-invalid={!!errors.tagsInput}
            aria-describedby={errors.tagsInput ? "listing-tags-error" : "listing-tags-hint"}
            {...register("tagsInput")}
          />
          {errors.tagsInput ? (
            <Typography id="listing-tags-error" variant="caption" className="text-destructive" role="alert">
              {errors.tagsInput.message}
            </Typography>
          ) : (
            <Typography id="listing-tags-hint" variant="caption" className="text-muted-foreground">
              Separate with commas.
            </Typography>
          )}
        </Stack>

        <ListingImageInput id="listing-image" value={image} onChange={setImage} />

        {isFood && (
          <div data-food-fields>
            <FoodListingFields value={food} onChange={handleFoodChange} errors={foodErrors} />
          </div>
        )}

        <Stack gap={2} className="flex-col-reverse sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            Preview Listing
          </Button>
        </Stack>
      </Stack>
    </form>
  )
}

export { ListingForm }

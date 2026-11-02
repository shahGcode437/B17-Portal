import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { AlignLeft, IdCard, Image as ImageIcon, Store, Tags } from "lucide-react"
import type { ListingKind } from "@/types/listing"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/forms/FieldError"
import { FormSection } from "@/components/forms/FormSection"
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
import { AreaField } from "@/features/provider/AreaField"
import { TagsField } from "@/features/provider/TagsField"
import { FoodListingFields } from "@/features/provider/FoodListingFields"
import { emptyFoodFormValues } from "@/features/provider/listingBuilders"
import { selectClassName } from "@/features/provider/formStyles"
import { useCategories } from "@/hooks/useCategories"
import type { CategoryModule } from "@/lib/api/dto/public"
import { FOOD_VERTICAL_LABEL } from "@/config/food"
import { DEFAULT_LOCALITY, canonicalLocality } from "@/config/localities"

interface ListingFormProps {
  kind: ListingKind
  /**
   * Which server taxonomy the category choice comes from: `services` (provider), `directory` (general
   * business) or `education` (a tutor's subject). Defaults from `kind`. The value submitted is the
   * category SLUG - the backend rejects a label or free text (`unknown_category`).
   */
  categoryModule?: CategoryModule
  /** Overrides the field label (a tutor picks a "Subject"). */
  categoryLabelText?: string
  defaultValues?: Partial<ListingFormValues>
  onSubmit: (values: ListingFormValues) => void
  /**
   * What the submit button says. It must name what the action DOES: a create submits the listing to moderation
   * ("Submit for Review"), an edit saves changes or resubmits a rejected listing. Never "Preview": nothing here
   * previews anything.
   */
  submitLabel?: string
  /**
   * True while the page's write is in flight. `onSubmit` does not return its promise (the page owns
   * the mutation), so react-hook-form cannot know - without this the button would stay live during a
   * slow save.
   */
  submitting?: boolean
  onBack: () => void
}

const businessTypeChoices = [
  { value: "general", title: "General Business", description: "Shops, pharmacies, salons and other local businesses." },
  { value: "food", title: FOOD_VERTICAL_LABEL, description: "Restaurants, cafes, bakeries and other places to eat." },
] as const

/**
 * Unified listing form (UI/UX Spec §18; VR5 sectioned grammar) — same fields for both onboarding types, category
 * input differs. For a Business (FD4) a "Business type" choice switches between the General category field and
 * the Food & Dining block; the listing is a Business either way.
 */
function ListingForm({
  kind,
  categoryModule,
  categoryLabelText,
  defaultValues,
  onSubmit,
  submitLabel = "Submit for Review",
  submitting = false,
  onBack,
}: ListingFormProps) {
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
      tagsInput: "",
      ...defaultValues,
      // `area` is a choice from the configured localities: an old free-text value is shown as B-17 and says so.
      area: canonicalLocality(defaultValues?.area ?? "") ?? DEFAULT_LOCALITY,
      vertical: defaultValues?.vertical ?? "general",
    },
  })
  const legacyArea = defaultValues?.area && !canonicalLocality(defaultValues.area) ? defaultValues.area : null

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
  // A Business saved as General carries no Food data, so warn when Food details exist but General is selected.
  const losesFoodData =
    isBusiness &&
    !isFood &&
    (food.categories.length > 0 ||
      food.serviceOptions.length > 0 ||
      food.hoursNote.trim() !== "" ||
      food.menuHighlights.length > 0 ||
      food.menuImage !== undefined)

  function handleFoodChange(next: FoodFormValues) {
    setFood(next)
    // Once errors are showing, keep them live so they clear as soon as the field is fixed.
    if (Object.keys(foodErrors).length > 0) setFoodErrors(validateFoodFields(next))
  }

  const nameLabel = kind === "provider" ? "Name" : "Business Name"
  const categoryLabel = categoryLabelText ?? (kind === "provider" ? "Service Category" : "Category")
  const module: CategoryModule = categoryModule ?? (kind === "provider" ? "services" : "directory")
  const categories = useCategories(module, { enabled: !isFood })
  const categoryOptions = categories.status === "success" ? categories.data : []
  const tagsValue = useWatch({ control, name: "tagsInput" })
  // What the tags ARE differs by listing kind (and is shown under a heading of its own on the public page).
  const isTutor = categoryModule === "education"
  const tagsCopy = isTutor
    ? { label: "Topics you teach (optional)", placeholder: "e.g. matric physics, O-level chemistry", purpose: "Topics and levels you teach; shown on your page and matched by search." }
    : kind === "provider"
      ? { label: "Services offered (optional)", placeholder: "e.g. solar panels, net metering, rooftop", purpose: "What you do, in short keywords; shown on your page and matched by search." }
      : isFood
        ? { label: "Dishes / Search Tags (optional)", placeholder: "e.g. biryani, karahi, family dining", purpose: "Dishes or keywords people might search for." }
        : { label: "Tags (optional)", placeholder: "e.g. stationery, printing, school supplies", purpose: "Keywords people might search for; shown on your page and matched by search." }

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
          <FormSection
            as="fieldset"
            icon={Store}
            title="Business type"
            description="This decides whether the listing uses the Food & Dining fields."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {businessTypeChoices.map((choice) => (
                <label
                  key={choice.value}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-input bg-card/70 p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    value={choice.value}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    {...register("vertical")}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{choice.title}</span>
                    <span className="block text-xs text-muted-foreground">{choice.description}</span>
                  </span>
                </label>
              ))}
            </div>
            {losesFoodData && (
              <Typography
                variant="body-sm"
                role="status"
                className="rounded-lg bg-destructive/10 px-3 py-2 font-medium text-destructive ring-1 ring-destructive/20"
              >
                Switching to General Business will remove Food-specific details when saved.
              </Typography>
            )}
          </FormSection>
        )}

        <FormSection
          icon={IdCard}
          title="Listing identity"
          description={isFood ? "What this place is called. The Food & Dining categories are chosen below." : "What this listing is called and the category it belongs to."}
        >
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
            <FieldError id="listing-name-error" message={errors.name?.message} />
          </Stack>

          {!isFood && (
            <Stack gap={2}>
              <Label htmlFor="listing-category">{categoryLabel}</Label>
              {/* `key`: the options arrive after mount; remounting re-applies the form's value (an edit prefill) to the select. */}
              <select
                key={categories.status}
                id="listing-category"
                className={selectClassName}
                defaultValue=""
                aria-invalid={!!errors.category}
                aria-describedby={errors.category ? "listing-category-error" : undefined}
                {...register("category")}
              >
                <option value="" disabled>
                  {categories.status === "loading" ? "Loading categories…" : categories.status === "error" ? "Categories unavailable" : "Choose a category"}
                </option>
                {categoryOptions.map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </select>
              {categories.status === "error" && (
                <Typography variant="body-sm" role="alert" className="font-medium text-destructive">
                  The categories could not be loaded. Reload the page to try again.
                </Typography>
              )}
              <FieldError id="listing-category-error" message={errors.category?.message} />
            </Stack>
          )}

          <AreaField id="listing-area" inputProps={register("area")} error={errors.area?.message} legacyArea={legacyArea} />
        </FormSection>

        <FormSection
          icon={AlignLeft}
          title="Description"
          description="A short, clear summary of what you offer. Shown on your public page."
        >
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
            <FieldError id="listing-description-error" message={errors.description?.message} />
          </Stack>
        </FormSection>

        {isFood && (
          <div data-food-fields>
            <FoodListingFields value={food} onChange={handleFoodChange} errors={foodErrors} />
          </div>
        )}

        <FormSection
          icon={Tags}
          title={isTutor ? "Topics & keywords" : isFood ? "Dishes & keywords" : "Services & keywords"}
          description="These help residents find your listing when they search."
        >
          <TagsField
            id="listing-tags"
            label={tagsCopy.label}
            placeholder={tagsCopy.placeholder}
            purpose={tagsCopy.purpose}
            value={tagsValue}
            error={errors.tagsInput?.message}
            inputProps={register("tagsInput")}
          />
        </FormSection>

        <FormSection
          icon={ImageIcon}
          title="Cover image"
          description="A photo on the public page. Image upload is a later release."
        >
          <ListingImageInput id="listing-image" value={image} onChange={setImage} />
        </FormSection>

        <Stack gap={2} className="flex-col-reverse sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" className="h-11 text-base font-semibold sm:h-10" disabled={isSubmitting || submitting} aria-busy={submitting}>
            {submitLabel}
          </Button>
        </Stack>
      </Stack>
    </form>
  )
}

export { ListingForm }

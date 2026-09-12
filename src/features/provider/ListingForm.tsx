import { useForm } from "react-hook-form"
import type { ListingKind } from "@/types/listing"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { zodResolver } from "@/lib/zodResolver"
import { listingSchema, type ListingFormValues } from "@/features/provider/listingSchema"
import { serviceCategories } from "@/data/serviceCategories"

interface ListingFormProps {
  kind: ListingKind
  defaultValues?: Partial<ListingFormValues>
  onSubmit: (values: ListingFormValues) => void
  onBack: () => void
}

const selectClassName = cn(
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
  "md:text-sm dark:bg-input/30"
)

/** Unified listing form (UI/UX Spec §18) — same fields for both onboarding types, category input differs. */
function ListingForm({ kind, defaultValues, onSubmit, onBack }: ListingFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ListingFormValues>({
    resolver: zodResolver(listingSchema),
    defaultValues: {
      name: "",
      category: "",
      description: "",
      area: "",
      tagsInput: "",
      ...defaultValues,
    },
  })

  const nameLabel = kind === "provider" ? "Name" : "Business Name"
  const categoryLabel = kind === "provider" ? "Service Category" : "Category"
  const tagsLabel = kind === "provider" ? "Services Offered" : "Services / Tags"

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <Stack gap={4}>
        <Stack gap={2}>
          <Label htmlFor="listing-name">{nameLabel}</Label>
          <Input
            id="listing-name"
            placeholder={kind === "provider" ? "e.g. B-17 Solar Solutions" : "e.g. Capital Stationery Mart"}
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
            placeholder="e.g. solar panels, net metering, rooftop"
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

import { useState } from "react"
import { useForm } from "react-hook-form"
import type { ListingKind } from "@/types/listing"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { zodResolver } from "@/lib/zodResolver"
import { listingSchema, type ListingFormValues } from "@/features/provider/listingSchema"
import { ListingImageInput } from "@/features/provider/ListingImageInput"
import { selectClassName } from "@/features/provider/formStyles"
import { serviceCategories } from "@/data/serviceCategories"

interface ListingFormProps {
  kind: ListingKind
  defaultValues?: Partial<ListingFormValues>
  onSubmit: (values: ListingFormValues) => void
  onBack: () => void
}

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

  // Kept outside react-hook-form: the value is a browser-local object URL,
  // not something a native input can hold via register(), and the image
  // only needs to be merged in at submit time.
  const [image, setImage] = useState<string | undefined>(defaultValues?.image)

  const nameLabel = kind === "provider" ? "Name" : "Business Name"
  const categoryLabel = kind === "provider" ? "Service Category" : "Category"
  const tagsLabel = kind === "provider" ? "Services Offered" : "Services / Tags"

  function submit(values: ListingFormValues) {
    onSubmit({ ...values, image })
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
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

        <ListingImageInput id="listing-image" value={image} onChange={setImage} />

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

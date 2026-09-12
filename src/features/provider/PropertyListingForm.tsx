import { useState } from "react"
import { useForm } from "react-hook-form"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { zodResolver } from "@/lib/zodResolver"
import { propertySchema, type PropertyFormValues } from "@/features/provider/listingSchema"
import { ListingImageInput } from "@/features/provider/ListingImageInput"
import { selectClassName } from "@/features/provider/formStyles"

interface PropertyListingFormProps {
  defaultValues?: Partial<PropertyFormValues>
  onSubmit: (values: PropertyFormValues) => void
  onBack: () => void
}

/**
 * Property onboarding form (Onboarding Fix §5) — a separate form from
 * ListingForm since the field set genuinely differs (sale/rent, property
 * type, price, bedrooms, furnishing) rather than a category/tags shape.
 * Deliberately simple: no map, GPS, mortgage, legal verification, or
 * booking/transaction fields.
 */
function PropertyListingForm({ defaultValues, onSubmit, onBack }: PropertyListingFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PropertyFormValues>({
    resolver: zodResolver(propertySchema),
    defaultValues: {
      title: "",
      listingType: "",
      propertyType: "",
      price: "",
      area: "",
      description: "",
      bedrooms: "",
      furnished: "",
      tagsInput: "",
      ...defaultValues,
    },
  })

  // Kept outside react-hook-form: the value is a browser-local object URL,
  // not something a native input can hold via register(), and the image
  // only needs to be merged in at submit time.
  const [image, setImage] = useState<string | undefined>(defaultValues?.image)

  function submit(values: PropertyFormValues) {
    onSubmit({ ...values, image })
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <Stack gap={4}>
        <Typography variant="caption" className="text-muted-foreground">
          This creates a Property listing — houses, flats and plots for sale or rent.
        </Typography>

        <Stack gap={2}>
          <Label htmlFor="property-title">Title</Label>
          <Input
            id="property-title"
            placeholder="e.g. 5 Marla House — B-17 Block C"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "property-title-error" : undefined}
            {...register("title")}
          />
          {errors.title && (
            <Typography id="property-title-error" variant="caption" className="text-destructive" role="alert">
              {errors.title.message}
            </Typography>
          )}
        </Stack>

        <Stack direction="row" gap={4} className="flex-col sm:flex-row">
          <Stack gap={2} className="flex-1">
            <Label htmlFor="property-listing-type">Listing Type</Label>
            <select
              id="property-listing-type"
              className={selectClassName}
              defaultValue=""
              aria-invalid={!!errors.listingType}
              aria-describedby={errors.listingType ? "property-listing-type-error" : undefined}
              {...register("listingType")}
            >
              <option value="" disabled>
                Choose one
              </option>
              <option value="sale">Sale</option>
              <option value="rent">Rent</option>
            </select>
            {errors.listingType && (
              <Typography id="property-listing-type-error" variant="caption" className="text-destructive" role="alert">
                {errors.listingType.message}
              </Typography>
            )}
          </Stack>

          <Stack gap={2} className="flex-1">
            <Label htmlFor="property-type">Property Type</Label>
            <select
              id="property-type"
              className={selectClassName}
              defaultValue=""
              aria-invalid={!!errors.propertyType}
              aria-describedby={errors.propertyType ? "property-type-error" : undefined}
              {...register("propertyType")}
            >
              <option value="" disabled>
                Choose one
              </option>
              <option value="House">House</option>
              <option value="Flat">Flat</option>
              <option value="Plot">Plot</option>
            </select>
            {errors.propertyType && (
              <Typography id="property-type-error" variant="caption" className="text-destructive" role="alert">
                {errors.propertyType.message}
              </Typography>
            )}
          </Stack>
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="property-price">Price</Label>
          <Input
            id="property-price"
            placeholder="e.g. PKR 2.2 Cr or PKR 55,000 / month"
            aria-invalid={!!errors.price}
            aria-describedby={errors.price ? "property-price-error" : undefined}
            {...register("price")}
          />
          {errors.price && (
            <Typography id="property-price-error" variant="caption" className="text-destructive" role="alert">
              {errors.price.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="property-area">Area</Label>
          <Input
            id="property-area"
            placeholder="e.g. B-17, Block C"
            aria-invalid={!!errors.area}
            aria-describedby={errors.area ? "property-area-error" : undefined}
            {...register("area")}
          />
          {errors.area && (
            <Typography id="property-area-error" variant="caption" className="text-destructive" role="alert">
              {errors.area.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="property-description">Description</Label>
          <Textarea
            id="property-description"
            placeholder="What should residents know about this property?"
            rows={3}
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? "property-description-error" : undefined}
            {...register("description")}
          />
          {errors.description && (
            <Typography id="property-description-error" variant="caption" className="text-destructive" role="alert">
              {errors.description.message}
            </Typography>
          )}
        </Stack>

        <Stack direction="row" gap={4} className="flex-col sm:flex-row">
          <Stack gap={2} className="flex-1">
            <Label htmlFor="property-bedrooms">Bedrooms (optional)</Label>
            <Input
              id="property-bedrooms"
              inputMode="numeric"
              placeholder="e.g. 3"
              aria-invalid={!!errors.bedrooms}
              aria-describedby={errors.bedrooms ? "property-bedrooms-error" : undefined}
              {...register("bedrooms")}
            />
            {errors.bedrooms && (
              <Typography id="property-bedrooms-error" variant="caption" className="text-destructive" role="alert">
                {errors.bedrooms.message}
              </Typography>
            )}
          </Stack>

          <Stack gap={2} className="flex-1">
            <Label htmlFor="property-furnished">Furnishing (optional)</Label>
            <select id="property-furnished" className={selectClassName} defaultValue="" {...register("furnished")}>
              <option value="">Not specified</option>
              <option value="Furnished">Furnished</option>
              <option value="Unfurnished">Unfurnished</option>
              <option value="Semi-Furnished">Semi-Furnished</option>
            </select>
          </Stack>
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="property-tags">Tags (optional)</Label>
          <Input
            id="property-tags"
            placeholder="e.g. corner plot, near park, main road"
            {...register("tagsInput")}
          />
          <Typography variant="caption" className="text-muted-foreground">
            Separate with commas.
          </Typography>
        </Stack>

        <ListingImageInput id="property-image" value={image} onChange={setImage} />

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

export { PropertyListingForm }

import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { AlignLeft, BedDouble, Home, IdCard, Image as ImageIcon, Tags } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/forms/FieldError"
import { FormSection } from "@/components/forms/FormSection"
import { zodResolver } from "@/lib/zodResolver"
import { propertySchema, type PropertyFormValues } from "@/features/provider/listingSchema"
import { ListingImageInput } from "@/features/provider/ListingImageInput"
import { AreaField } from "@/features/provider/AreaField"
import { TagsField } from "@/features/provider/TagsField"
import { selectClassName } from "@/features/provider/formStyles"
import { useCategories } from "@/hooks/useCategories"
import { DEFAULT_LOCALITY, canonicalLocality } from "@/config/localities"

interface PropertyListingFormProps {
  defaultValues?: Partial<PropertyFormValues>
  onSubmit: (values: PropertyFormValues) => void
  /** What the submit button says; it names what the action does (see `ListingForm`), never "Preview". */
  submitLabel?: string
  /** True while the page's write is in flight (see `ListingForm`'s `submitting`). */
  submitting?: boolean
  onBack: () => void
}

/**
 * Property onboarding form (Onboarding Fix §5; VR5 sectioned grammar). Separate from `ListingForm` because the
 * field set genuinely differs (sale/rent, property type, price, bedrooms, furnishing) rather than a
 * category/tags shape. Deliberately simple: no map, GPS, mortgage, legal verification, booking or transaction
 * fields.
 */
function PropertyListingForm({ defaultValues, onSubmit, submitLabel = "Submit for Review", submitting = false, onBack }: PropertyListingFormProps) {
  // The property types are the server's (`GET /categories?module=property`); the submitted value is the SLUG.
  const types = useCategories("property")
  const propertyTypes = types.status === "success" ? types.data : []
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<PropertyFormValues>({
    resolver: zodResolver(propertySchema),
    defaultValues: {
      title: "",
      listingType: "",
      propertyType: "",
      price: "",
      description: "",
      bedrooms: "",
      furnished: "",
      tagsInput: "",
      ...defaultValues,
      // `area` is a choice from the configured localities: an old free-text value is shown as B-17 and says so.
      area: canonicalLocality(defaultValues?.area ?? "") ?? DEFAULT_LOCALITY,
    },
  })
  const tagsValue = useWatch({ control, name: "tagsInput" })
  const legacyArea = defaultValues?.area && !canonicalLocality(defaultValues.area) ? defaultValues.area : null

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

        <FormSection
          icon={IdCard}
          title="Property identity"
          description="A clear title and whether the property is for sale or for rent."
        >
          <Stack gap={2}>
            <Label htmlFor="property-title">Title</Label>
            <Input
              id="property-title"
              placeholder="e.g. 5 Marla House — B-17 Block C"
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? "property-title-error" : undefined}
              {...register("title")}
            />
            <FieldError id="property-title-error" message={errors.title?.message} />
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
              <FieldError id="property-listing-type-error" message={errors.listingType?.message} />
            </Stack>

            <Stack gap={2} className="flex-1">
              <Label htmlFor="property-type">Property Type</Label>
              {/* `key`: the options arrive after mount; remounting re-applies the form's value (an edit prefill). */}
              <select
                key={types.status}
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
                {propertyTypes.map((type) => (
                  <option key={type.slug} value={type.slug}>
                    {type.name}
                  </option>
                ))}
              </select>
              <FieldError id="property-type-error" message={errors.propertyType?.message} />
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
            <FieldError id="property-price-error" message={errors.price?.message} />
          </Stack>

          <AreaField id="property-area" inputProps={register("area")} error={errors.area?.message} legacyArea={legacyArea} />
        </FormSection>

        <FormSection
          icon={AlignLeft}
          title="Description"
          description="What should residents know about this property? Shown on the public page."
        >
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
            <FieldError id="property-description-error" message={errors.description?.message} />
          </Stack>
        </FormSection>

        <FormSection
          icon={Home}
          title="Property specs"
          description="Bedrooms and furnishing, where they apply. Optional."
        >
          <Stack direction="row" gap={4} className="flex-col sm:flex-row">
            <Stack gap={2} className="flex-1">
              <Label htmlFor="property-bedrooms">
                <span className="inline-flex items-center gap-1.5">
                  <BedDouble className="size-4 text-primary" aria-hidden="true" />
                  Bedrooms (optional)
                </span>
              </Label>
              <Input
                id="property-bedrooms"
                inputMode="numeric"
                placeholder="e.g. 3"
                aria-invalid={!!errors.bedrooms}
                aria-describedby={errors.bedrooms ? "property-bedrooms-error" : undefined}
                {...register("bedrooms")}
              />
              <FieldError id="property-bedrooms-error" message={errors.bedrooms?.message} />
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
        </FormSection>

        <FormSection
          icon={Tags}
          title="Search tags"
          description="Features people might search for; shown on the property page."
        >
          <TagsField
            id="property-tags"
            label="Tags (optional)"
            placeholder="e.g. corner plot, near park, main road"
            purpose="Features people might search for; shown on the property page and matched by search."
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
          <ListingImageInput id="property-image" value={image} onChange={setImage} />
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

export { PropertyListingForm }

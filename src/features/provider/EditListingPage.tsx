import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { motion } from "motion/react"
import { ArrowLeft } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/feedback/EmptyState"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { ProviderCard } from "@/components/cards/ProviderCard"
import { BusinessCard } from "@/components/cards/BusinessCard"
import { PropertyCard } from "@/components/cards/PropertyCard"
import { ListingForm } from "@/features/provider/ListingForm"
import { PropertyListingForm } from "@/features/provider/PropertyListingForm"
import { FoodListingSummary } from "@/features/provider/FoodListingSummary"
import {
  buildProvider,
  buildBusiness,
  buildProperty,
  emptyFoodFormValues,
  foodProfileToFormValues,
} from "@/features/provider/listingBuilders"
import type { ListingFormValues, PropertyFormValues } from "@/features/provider/listingSchema"
import { useListingsStore, selectListingsBySubmitter } from "@/state/listingsStore"
import { useToast } from "@/hooks/useToast"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { useRequireOnline } from "@/hooks/useRequireOnline"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"
import type { Provider } from "@/types/provider"
import type { Business } from "@/types/business"
import type { Property } from "@/types/property"

type Step = "form" | "preview"

/**
 * Listing data -> form values. A Food & Dining Business is prefilled with its whole FoodProfile
 * (categories, services, hours, menu highlights, menu image) so editing and resubmitting never
 * drops it; everything else keeps its previous (general) shape.
 */
function toListingValues(data: Provider | Business): ListingFormValues {
  const base = {
    name: data.name,
    category: data.category,
    description: data.description,
    area: data.area,
    tagsInput: data.tags.join(", "),
    image: data.image,
  }
  if ("vertical" in data && data.vertical === "food") {
    return { ...base, vertical: "food", food: data.food ? foodProfileToFormValues(data.food) : emptyFoodFormValues() }
  }
  return { ...base, vertical: "general" }
}

function toPropertyValues(data: Property): PropertyFormValues {
  return {
    title: data.title,
    listingType: data.listingType,
    propertyType: data.propertyType,
    price: data.price,
    area: data.area,
    description: data.description ?? "",
    bedrooms: data.bedrooms ? String(data.bedrooms) : "",
    furnished: data.furnished ?? "",
    tagsInput: data.tags.join(", "),
    image: data.image,
  }
}

/**
 * Edit an existing listing (Phase 9D) — reuses the same `ListingForm`/
 * `PropertyListingForm` from onboarding, seeded with the listing's current
 * data via `defaultValues`. On submit, calls the (previously unused)
 * `resubmitListing` action, which resets status to "pending" and clears any
 * rejection reason — an edited listing always goes back through moderation,
 * regardless of what its status was before, matching the existing
 * moderation lifecycle rather than inventing a new one.
 */
function EditListingPage() {
  const user = useRequireAuth()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { show } = useToast()
  const requireOnline = useRequireOnline()
  const { listings, resubmitListing } = useListingsStore()
  const [step, setStep] = useState<Step>("form")
  const [values, setValues] = useState<ListingFormValues | PropertyFormValues | null>(null)

  if (!user) return null

  const listing = id ? selectListingsBySubmitter(listings, user.name).find((l) => l.id === id) : undefined

  if (!listing) {
    return (
      <Container className="py-16">
        <EmptyState
          headingLevel={1}
          title="Listing not found"
          description="This listing doesn't exist, isn't yours, or may have been removed."
          actionLabel="Back to Listings"
          onAction={() => navigate(routes.providerListings)}
        />
      </Container>
    )
  }

  if (listing.status === "archived") {
    return (
      <Container className="py-16">
        <EmptyState
          headingLevel={1}
          title="This listing is archived"
          description="Archived listings can't be edited in this demo."
          actionLabel="Back to Listings"
          onAction={() => navigate(routes.providerListings)}
        />
      </Container>
    )
  }

  function handleFormSubmit(nextValues: ListingFormValues | PropertyFormValues) {
    setValues(nextValues)
    setStep("preview")
  }

  function handleFinalSubmit() {
    if (!requireOnline()) return
    if (!listing || !values) return
    if (listing.kind === "property") {
      resubmitListing(listing.id, buildProperty(values as PropertyFormValues, listing.id))
    } else if (listing.kind === "provider") {
      resubmitListing(listing.id, buildProvider(values as ListingFormValues, listing.id))
    } else {
      resubmitListing(listing.id, buildBusiness(values as ListingFormValues, listing.id))
    }
    show("Listing updated — resubmitted for review (demo)")
    navigate(routes.providerListings)
  }

  const previewValues = values
  const previewProperty =
    step === "preview" && listing.kind === "property" && previewValues
      ? buildProperty(previewValues as PropertyFormValues, listing.id)
      : null
  const previewNonProperty =
    step === "preview" && listing.kind !== "property" && previewValues
      ? listing.kind === "provider"
        ? buildProvider(previewValues as ListingFormValues, listing.id)
        : buildBusiness(previewValues as ListingFormValues, listing.id)
      : null

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-xl">
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">Edit Listing</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Editing resubmits this listing for review — it won't stay public while changes are
              pending.
            </Typography>
          </Stack>

          {step === "form" && listing.kind === "property" && (
            <PropertyListingForm
              defaultValues={toPropertyValues(listing.data as Property)}
              onBack={() => navigate(routes.providerListings)}
              onSubmit={handleFormSubmit}
            />
          )}

          {step === "form" && listing.kind !== "property" && (
            <ListingForm
              kind={listing.kind}
              // After "Edit" from the preview, keep what was already typed (incl. the Food block) instead of
              // reverting to the stored listing.
              defaultValues={(values as ListingFormValues | null) ?? toListingValues(listing.data as Provider | Business)}
              onBack={() => navigate(routes.providerListings)}
              onSubmit={handleFormSubmit}
            />
          )}

          {step === "preview" && (
            <Stack gap={4}>
              <Stack direction="row" align="center" justify="between" gap={2}>
                <Typography variant="label">Preview</Typography>
                <DemoBadge label="Demo Preview" />
              </Stack>

              {previewNonProperty && listing.kind === "provider" && <ProviderCard provider={previewNonProperty as Provider} />}
              {previewNonProperty && listing.kind === "business" && <BusinessCard business={previewNonProperty as Business} />}
              {previewNonProperty && listing.kind === "business" && (
                <FoodListingSummary business={previewNonProperty as Business} headingLevel={2} />
              )}
              {previewProperty && <PropertyCard property={previewProperty} />}

              <Typography variant="caption" className="text-muted-foreground">
                Resubmitting will set this listing's status back to Pending Review.
              </Typography>

              <Stack gap={2} className="flex-col-reverse sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setStep("form")}>
                  <ArrowLeft />
                  Edit
                </Button>
                <Button type="button" onClick={handleFinalSubmit}>
                  Resubmit for Review
                </Button>
              </Stack>
            </Stack>
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { EditListingPage }

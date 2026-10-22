import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { PenLine } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ReadError } from "@/components/feedback/ReadError"
import { ListingForm } from "@/features/provider/ListingForm"
import { PropertyListingForm } from "@/features/provider/PropertyListingForm"
import { LocationFieldset } from "@/features/provider/LocationFieldset"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { useMutation } from "@/hooks/useMutation"
import { useRead } from "@/hooks/useRead"
import { useToast } from "@/hooks/useToast"
import { fetchOwnerListing } from "@/lib/api/reads/owner"
import { toOwnerListing } from "@/lib/api/ownerAdapters"
import { patchListing } from "@/lib/api/writes/listings"
import type { LocationWrite } from "@/lib/api/writes/listings"
import { listingPatchFrom, propertyPatchFrom, toLocationWrite } from "@/features/provider/listingWriteAdapters"
import { foodProfileToFormValues } from "@/features/provider/listingBuilders"
import { fieldErrors, isApiError } from "@/lib/api/errors"
import { userMessageFor, isConflict, isNoChanges } from "@/lib/api/writeErrors"
import { routes } from "@/config/routes"
import type { OwnerListingView } from "@/types/ownerListing"
import type { ListingFormValues, PropertyFormValues } from "@/features/provider/listingSchema"

type Kind = "provider" | "business" | "tutor" | "property"

/**
 * Edit one of the owner's own listings (Phase 12H). The current listing is loaded through
 * `GET /users/me/listings/{id}` (with its `revision`); the submitted PATCH carries that revision as
 * the concurrency token. A stale `409 listing_conflict` reloads the record (so the owner sees the
 * other change) and preserves their current form state. `no_changes` on a rejected resubmission is
 * surfaced plainly; a `pending`→`approved` transition is explained with "Changes submitted for review".
 */
function EditListingPage() {
  const { id } = useParams<{ id: string }>()
  const user = useRequireAuth()
  const read = useRead(
    `owner-edit:${id ?? ""}`,
    async (signal) => (id ? toOwnerListing(await fetchOwnerListing(id, signal)) : null),
    { enabled: user !== null && !!id }
  )
  const navigate = useNavigate()

  if (!user) return null
  if (read.status === "loading")
    return (
      <Container className="py-8">
        <Skeleton className="h-96 w-full" />
      </Container>
    )
  if (read.status === "error") {
    if (read.error.status === 404) {
      return (
        <Container className="py-16">
          <EmptyState
            headingLevel={1}
            icon={PenLine}
            title="Listing not found"
            description="This listing was not found in your account."
            actionLabel="Back to My Listings"
            onAction={() => navigate(routes.providerListings)}
          />
        </Container>
      )
    }
    return (
      <Container className="py-16">
        <ReadError error={read.error} onRetry={read.retry} headingLevel={1} />
      </Container>
    )
  }
  if (!read.data) return null
  // `key` on the revision rebuilds the shell state when the listing is re-read (e.g. after a 409
  // conflict), so the location / grade fields rehydrate from the server without a setState-in-effect.
  return <EditShell key={read.data.revision} listing={read.data} onReload={read.retry} />
}

function EditShell({ listing, onReload }: { listing: OwnerListingView; onReload: () => void }) {
  const navigate = useNavigate()
  const { show } = useToast()
  const kind = listing.kind as Kind
  const [location, setLocation] = useState<LocationWrite>(() => toLocationWrite(listing))
  const [grade, setGrade] = useState<string>(() => (kind === "tutor" ? listing.grade ?? "" : ""))
  const [locationErrors, setLocationErrors] = useState<Record<string, string>>({})
  const patchMutation = useMutation(({ body }: { body: Parameters<typeof patchListing>[1] }) => patchListing(listing.id, body))

  const defaults = useMemo(() => toFormDefaults(listing), [listing])

  const submit = async (values: ListingFormValues | PropertyFormValues) => {
    setLocationErrors({})
    if (kind === "property" && location.visibility === "area_only") {
      setLocationErrors({ "location.visibility": "A property must have at least an approximate point." })
      return
    }
    const body =
      kind === "property"
        ? propertyPatchFrom(listing.revision, values as PropertyFormValues, location)
        : listingPatchFrom(listing.revision, kind === "tutor" ? "tutor" : kind === "provider" ? "provider" : "business", values as ListingFormValues, location, kind === "tutor" ? grade.trim() : undefined)
    try {
      const updated = await patchMutation.mutate({ body })
      if (updated.status === "pending" && listing.status === "approved") {
        show("Changes submitted for review")
      } else {
        show("Listing updated")
      }
      navigate(routes.providerListings)
    } catch (error) {
      if (isConflict(error)) {
        show(userMessageFor(error, "patch-listing").title)
        onReload()
        return
      }
      if (isNoChanges(error)) {
        show("Please change at least one field before resubmitting.")
        return
      }
      if (isApiError(error) && error.code === "validation_error") {
        setLocationErrors(fieldErrors(error))
      }
    }
  }

  const errorCopy = patchMutation.status === "error" && !isConflict(patchMutation.error) && !isNoChanges(patchMutation.error) ? userMessageFor(patchMutation.error, "patch-listing") : null

  return (
    <Container className="py-8 sm:py-12">
      <Stack gap={6} className="mx-auto max-w-2xl">
        <Stack gap={1}>
          <Typography variant="h1">Edit Listing</Typography>
          <Typography variant="body-sm" className="text-muted-foreground">
            Status: {listing.status} · revision {listing.revision}
          </Typography>
          {listing.status === "rejected" && listing.rejectionReason && (
            <Typography variant="body-sm" className="rounded-lg bg-destructive/5 px-3 py-2 text-destructive">
              Rejected: {listing.rejectionReason}
            </Typography>
          )}
        </Stack>

        {errorCopy && (
          <Typography variant="body-sm" role="alert" className="rounded-lg bg-destructive/5 px-3 py-2 text-destructive">
            {errorCopy.title}
            {errorCopy.description ? ` — ${errorCopy.description}` : ""}
          </Typography>
        )}

        {kind === "tutor" && (
          <Stack gap={2}>
            <Label htmlFor="tutor-grade">Grade / level you teach</Label>
            <Input id="tutor-grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
          </Stack>
        )}

        <LocationFieldset
          value={location}
          onChange={setLocation}
          itemLabel={listing.title}
          allowedVisibilities={kind === "property" ? ["exact", "approximate"] : ["area_only", "approximate", "exact"]}
          errors={locationErrors}
          disabled={patchMutation.pending}
        />

        {kind === "property" ? (
          <PropertyListingForm defaultValues={defaults as PropertyFormValues} onBack={() => navigate(routes.providerListings)} onSubmit={submit} submitting={patchMutation.pending} />
        ) : (
          <ListingForm
            kind={kind === "tutor" ? "provider" : kind === "provider" ? "provider" : "business"}
            categoryModule={kind === "tutor" ? "education" : undefined}
            categoryLabelText={kind === "tutor" ? "Subject" : undefined}
            defaultValues={defaults as Partial<ListingFormValues>}
            onBack={() => navigate(routes.providerListings)}
            onSubmit={submit}
            submitting={patchMutation.pending}
          />
        )}
      </Stack>
    </Container>
  )
}

function toFormDefaults(listing: OwnerListingView): Partial<ListingFormValues> | Partial<PropertyFormValues> {
  if (listing.kind === "property") {
    return {
      title: listing.title,
      listingType: listing.listingType ?? "",
      propertyType: listing.categorySlug ?? "",
      price: listing.price ?? "",
      description: listing.description ?? "",
      area: listing.area,
      bedrooms: listing.bedrooms !== undefined ? String(listing.bedrooms) : "",
      furnished: listing.furnished ?? "",
      tagsInput: listing.tags.join(", "),
      ...(listing.image ? { image: listing.image } : {}),
    }
  }
  const defaults: Partial<ListingFormValues> = {
    name: listing.title,
    category: listing.categorySlug ?? "",
    description: listing.description ?? "",
    area: listing.area,
    tagsInput: listing.tags.join(", "),
    ...(listing.image ? { image: listing.image } : {}),
  }
  if (listing.kind === "business") {
    if (listing.vertical === "food" && listing.food) {
      // The union demands food data for a food business.
      return {
        ...defaults,
        vertical: "food",
        food: foodProfileToFormValues(listing.food),
      }
    }
    return { ...defaults, vertical: "general" }
  }
  return defaults
}

export { EditListingPage }

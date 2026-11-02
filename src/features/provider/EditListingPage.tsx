import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { PenLine } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ReadError } from "@/components/feedback/ReadError"
import { PageHeader } from "@/components/workspace/PageHeader"
import { FormAlert } from "@/components/forms/FormAlert"
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
import { isApiError, isResourceNotFound } from "@/lib/api/errors"
import { copyAsSentence, friendlyFieldErrors, userMessageFor, isConflict, isNoChanges } from "@/lib/api/writeErrors"
import { locationTextProblems } from "@/features/provider/locationRules"
import { TutorGradeField } from "@/features/provider/TutorGradeField"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { routes } from "@/config/routes"
import type { OwnerListingView } from "@/types/ownerListing"
import { gradeProblem } from "@/features/provider/listingSchema"
import type { ListingFormValues, PropertyFormValues } from "@/features/provider/listingSchema"

type Kind = "provider" | "business" | "tutor" | "property"

/**
 * Edit one of the owner's own listings (Phase 12H). The current listing is loaded through
 * `GET /users/me/listings/{id}` (with its `revision`); the submitted PATCH carries that revision as
 * the concurrency token. A stale `409 listing_conflict` reloads the record (so the owner sees the
 * other change) and preserves their current form state. `no_changes` on a rejected resubmission is
 * surfaced plainly. The button and the success message say what the save DOES: a rejected listing is
 * "resubmitted for review", an approved one "returns to review" when the change is material (a pure privacy
 * narrowing keeps its status), a pending one is simply saved.
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
    if (isResourceNotFound(read.error)) {
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
  const [gradeError, setGradeError] = useState<string | null>(null)
  const [locationErrors, setLocationErrors] = useState<Record<string, string>>({})
  const patchMutation = useMutation(({ body }: { body: Parameters<typeof patchListing>[1] }) => patchListing(listing.id, body))

  const defaults = useMemo(() => toFormDefaults(listing), [listing])
  // The button names the action: a rejected listing goes back to moderation; any other save is a save.
  const submitLabel = listing.status === "rejected" ? "Resubmit for Review" : "Save Changes"

  const submit = async (values: ListingFormValues | PropertyFormValues) => {
    setLocationErrors({})
    if (kind === "property" && location.visibility === "area_only") {
      setLocationErrors({ "location.visibility": "A property must have at least an approximate point." })
      return
    }
    const textProblems = locationTextProblems(location)
    if (Object.keys(textProblems).length > 0) {
      setLocationErrors(textProblems)
      return
    }
    const gradeIssue = kind === "tutor" ? gradeProblem(grade) : null
    if (gradeIssue) {
      setGradeError(gradeIssue)
      return
    }
    setGradeError(null)
    const body =
      kind === "property"
        ? propertyPatchFrom(listing.revision, values as PropertyFormValues, location)
        : listingPatchFrom(listing.revision, kind === "tutor" ? "tutor" : kind === "provider" ? "provider" : "business", values as ListingFormValues, location, kind === "tutor" ? grade.trim() : undefined)
    try {
      const updated = await patchMutation.mutate({ body })
      if (updated.status === "pending" && listing.status === "approved") {
        show("Changes submitted for review")
      } else if (updated.status === "pending" && listing.status === "rejected") {
        show("Listing resubmitted for review")
      } else {
        show("Listing updated")
      }
      navigate(routes.providerListings)
    } catch (error) {
      if (isConflict(error)) {
        show(copyAsSentence(userMessageFor(error, "patch-listing")), { tone: "error" })
        onReload()
        return
      }
      if (isNoChanges(error)) {
        show("Please change at least one field before resubmitting.", { tone: "error" })
        return
      }
      if (isApiError(error) && error.code === "validation_error") {
        setLocationErrors(friendlyFieldErrors(error))
      }
    }
  }

  const errorCopy = patchMutation.status === "error" && !isConflict(patchMutation.error) && !isNoChanges(patchMutation.error) ? userMessageFor(patchMutation.error, "patch-listing") : null

  return (
    <Container className="py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Stack gap={6}>
          <PageHeader
            icon={PenLine}
            eyebrow={`Professional · ${listing.title}`}
            title="Edit Listing"
            description={
              listing.status === "approved"
                ? "This listing is live. A change to its content sends it back to review; narrowing who can see its location does not."
                : listing.status === "rejected"
                  ? listing.takenDown
                    ? "A moderator took this listing down, so it is no longer public. Fix what they raised, then resubmit it for review."
                    : "Edit what the review asked for, then resubmit."
                  : "This listing is waiting for review. Saving changes keeps it in the queue."
            }
            actions={
              <Stack direction="row" align="center" gap={2} wrap>
                <ListingStatusBadge status={listing.status} takenDown={listing.takenDown} />
                <Typography as="span" variant="caption" className="text-muted-foreground">
                  revision {listing.revision}
                </Typography>
              </Stack>
            }
          />
          {listing.status === "rejected" && listing.rejectionReason && (
            <Typography
              variant="body-sm"
              className="rounded-xl bg-destructive/10 px-4 py-3 font-medium text-destructive ring-1 ring-destructive/20"
            >
              {`${listing.takenDown ? "Taken down" : "Rejected"}: ${listing.rejectionReason}`}
            </Typography>
          )}

          {errorCopy && (
            <FormAlert tone="error" title={errorCopy.title} description={errorCopy.description} />
          )}

          {kind === "tutor" && <TutorGradeField value={grade} onChange={setGrade} error={gradeError} disabled={patchMutation.pending} />}

        <LocationFieldset
          value={location}
          onChange={setLocation}
          itemLabel={listing.title}
          allowedVisibilities={kind === "property" ? ["exact", "approximate"] : ["area_only", "approximate", "exact"]}
          errors={locationErrors}
          disabled={patchMutation.pending}
        />

          {kind === "property" ? (
            <PropertyListingForm defaultValues={defaults as PropertyFormValues} onBack={() => navigate(routes.providerListings)} onSubmit={submit} submitLabel={submitLabel} submitting={patchMutation.pending} />
          ) : (
            <ListingForm
              kind={kind === "tutor" ? "provider" : kind === "provider" ? "provider" : "business"}
              categoryModule={kind === "tutor" ? "education" : undefined}
              categoryLabelText={kind === "tutor" ? "Subject" : undefined}
              defaultValues={defaults as Partial<ListingFormValues>}
              onBack={() => navigate(routes.providerListings)}
              onSubmit={submit}
              submitLabel={submitLabel}
              submitting={patchMutation.pending}
            />
          )}
        </Stack>
      </div>
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

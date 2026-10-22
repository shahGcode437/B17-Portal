import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ListingForm } from "@/features/provider/ListingForm"
import { PropertyListingForm } from "@/features/provider/PropertyListingForm"
import { LocationFieldset } from "@/features/provider/LocationFieldset"
import { useMutation } from "@/hooks/useMutation"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { useToast } from "@/hooks/useToast"
import { createListing } from "@/lib/api/writes/listings"
import type { LocationWrite } from "@/lib/api/writes/listings"
import {
  businessCreate,
  propertyCreate,
  providerCreate,
  tutorCreate,
} from "@/features/provider/listingWriteAdapters"
import { fieldErrors, isApiError } from "@/lib/api/errors"
import { userMessageFor } from "@/lib/api/writeErrors"
import { routes } from "@/config/routes"
import type { ListingFormValues, PropertyFormValues } from "@/features/provider/listingSchema"

type Kind = "provider" | "business" | "tutor" | "property"

const KIND_CHOICES: { value: Kind; title: string; description: string }[] = [
  { value: "provider", title: "Service / Professional", description: "Trades, construction, electrical, cleaning and other services you provide." },
  { value: "business", title: "Business / Shop", description: "A retail business, including restaurants, cafes and bakeries (Food & Dining)." },
  { value: "tutor", title: "Tutor", description: "Individual tutoring in a subject or for a grade." },
  { value: "property", title: "Property", description: "A house, flat or plot for sale or rent." },
]

const DEFAULT_LOCATION: Record<Kind, LocationWrite> = {
  provider: { visibility: "area_only" },
  tutor: { visibility: "area_only" },
  business: { visibility: "exact" },
  property: { visibility: "exact" },
}

const ALLOWED_VISIBILITY: Record<Kind, ReadonlyArray<"exact" | "approximate" | "area_only">> = {
  provider: ["area_only", "approximate", "exact"],
  tutor: ["area_only", "approximate", "exact"],
  business: ["exact", "approximate", "area_only"],
  // Property forbids area_only (API_CONTRACT §10.6 / LOCATION_MAP §6).
  property: ["exact", "approximate"],
}

/**
 * Create a listing (Phase 12H). The owner picks a kind, fills the shared form (`ListingForm` for
 * provider / business / tutor, `PropertyListingForm` for property) plus a `LocationFieldset`, and
 * submits to `POST /listings`. The server is the authority: a success navigates to the real owner
 * listings page (with the new row visible, backed by `GET /users/me/listings`); a `422` maps field
 * errors back onto the location block; a plan-limit or verification problem is announced plainly.
 */
function ListingFormPage() {
  const user = useRequireAuth()
  const navigate = useNavigate()
  const { show } = useToast()
  const [kind, setKind] = useState<Kind | null>(null)
  const [location, setLocation] = useState<LocationWrite>({ visibility: "area_only" })
  const [grade, setGrade] = useState("")
  const [gradeError, setGradeError] = useState<string | null>(null)
  const [locationErrors, setLocationErrors] = useState<Record<string, string>>({})
  const createMutation = useMutation(createListing)

  if (!user) return null

  if (!kind) {
    return (
      <Container className="py-8 sm:py-12">
        <Stack gap={6} className="mx-auto max-w-2xl">
          <Stack gap={1}>
            <Typography variant="h1">List Your Business / Service / Property</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              What are you listing? You can change this on the next step.
            </Typography>
          </Stack>
          <Stack gap={3}>
            {KIND_CHOICES.map((choice) => (
              <Card key={choice.value} variant="workspace" className="p-0">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal p-4 text-left"
                  onClick={() => {
                    setKind(choice.value)
                    setLocation(DEFAULT_LOCATION[choice.value])
                  }}
                >
                  <Stack gap={1}>
                    <Typography as="span" variant="label">
                      {choice.title}
                    </Typography>
                    <Typography as="span" variant="body-sm" className="text-muted-foreground">
                      {choice.description}
                    </Typography>
                  </Stack>
                </Button>
              </Card>
            ))}
          </Stack>
        </Stack>
      </Container>
    )
  }

  const submit = async (values: ListingFormValues | PropertyFormValues) => {
    setLocationErrors({})
    // Property forbids area_only.
    if (kind === "property" && location.visibility === "area_only") {
      setLocationErrors({ "location.visibility": "A property must have at least an approximate point." })
      return
    }
    if (kind === "tutor" && grade.trim().length < 1) {
      setGradeError("Please enter the grade you teach.")
      return
    }
    setGradeError(null)
    try {
      const payload =
        kind === "property"
          ? propertyCreate(values as PropertyFormValues, location)
          : kind === "tutor"
            ? tutorCreate(values as ListingFormValues, grade.trim(), location)
            : kind === "provider"
              ? providerCreate(values as ListingFormValues, location)
              : businessCreate(values as ListingFormValues, location)
      const created = await createMutation.mutate(payload)
      show("Listing submitted for review")
      navigate(routes.providerListings, { state: { highlightId: created.id } })
    } catch (error) {
      if (isApiError(error) && error.code === "validation_error") {
        setLocationErrors(fieldErrors(error))
      }
    }
  }

  const errorCopy = createMutation.status === "error" ? userMessageFor(createMutation.error, "create-listing") : null

  const formProps = {
    onBack: () => setKind(null),
    onSubmit: submit,
    submitting: createMutation.pending,
  }

  return (
    <Container className="py-8 sm:py-12">
      <Stack gap={6} className="mx-auto max-w-2xl">
        <Stack gap={1}>
          <Typography variant="h1">List Your Business / Service / Property</Typography>
          <Typography variant="body-sm" className="text-muted-foreground">
            {KIND_CHOICES.find((c) => c.value === kind)?.title}. Everything you submit is reviewed before it is public.
          </Typography>
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
            <Input
              id="tutor-grade"
              placeholder="e.g. Grade 9 or O-Level"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              aria-invalid={!!gradeError}
            />
            {gradeError && (
              <Typography variant="caption" role="alert" className="text-destructive">
                {gradeError}
              </Typography>
            )}
          </Stack>
        )}

        <LocationFieldset
          value={location}
          onChange={setLocation}
          itemLabel="this listing"
          allowedVisibilities={ALLOWED_VISIBILITY[kind]}
          errors={locationErrors}
          disabled={createMutation.pending}
        />

        {kind === "property" ? (
          <PropertyListingForm {...formProps} />
        ) : (
          <ListingForm
            kind={kind === "tutor" ? "provider" : kind}
            categoryModule={kind === "tutor" ? "education" : undefined}
            categoryLabelText={kind === "tutor" ? "Subject" : undefined}
            {...formProps}
          />
        )}
      </Stack>
    </Container>
  )
}

export { ListingFormPage }

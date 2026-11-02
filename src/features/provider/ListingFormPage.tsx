import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, Building2, GraduationCap, KeyRound, PlusCircle, Wrench } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { PageHeader } from "@/components/workspace/PageHeader"
import { FormAlert } from "@/components/forms/FormAlert"
import { ListingForm } from "@/features/provider/ListingForm"
import { PropertyListingForm } from "@/features/provider/PropertyListingForm"
import { LocationFieldset } from "@/features/provider/LocationFieldset"
import { ListingLimitNotice } from "@/features/provider/ListingLimitNotice"
import { useListingQuota } from "@/features/provider/listingQuota"
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
import { isApiError } from "@/lib/api/errors"
import { friendlyFieldErrors, userMessageFor } from "@/lib/api/writeErrors"
import { locationTextProblems } from "@/features/provider/locationRules"
import { TutorGradeField } from "@/features/provider/TutorGradeField"
import { routes } from "@/config/routes"
import { gradeProblem } from "@/features/provider/listingSchema"
import type { ListingFormValues, PropertyFormValues } from "@/features/provider/listingSchema"

type Kind = "provider" | "business" | "tutor" | "property"

interface KindChoice {
  value: Kind
  title: string
  description: string
  icon: LucideIcon
}

const KIND_CHOICES: KindChoice[] = [
  { value: "provider", title: "Service / Professional", description: "Trades, construction, electrical, cleaning and other services you provide.", icon: Wrench },
  { value: "business", title: "Business / Shop", description: "A retail business, including restaurants, cafes and bakeries (Food & Dining).", icon: Building2 },
  { value: "tutor", title: "Tutor", description: "Individual tutoring in a subject or for a grade.", icon: GraduationCap },
  { value: "property", title: "Property", description: "A house, flat or plot for sale or rent.", icon: KeyRound },
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
 * Create a listing (Phase 12H; VR5 visuals). The owner picks a kind, fills the shared form (`ListingForm` for
 * provider / business / tutor, `PropertyListingForm` for property) plus a `LocationFieldset`, and submits to
 * `POST /listings`. The server is the authority: success navigates to the real owner listings page with the new
 * row highlighted; a `422` maps field errors back onto the location block; a plan-limit or verification problem
 * is announced plainly through `FormAlert`. The over-the-limit warning stays as advice from the counts the
 * browser has — it blocks nothing, and `plan_limit_reached` is still mapped if the count was stale.
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
  const quota = useListingQuota()
  const limitNotice = quota.state === "full" ? <ListingLimitNotice where="create" used={quota.used} max={quota.max} /> : null

  if (!user) return null

  if (!kind) {
    return (
      <Container className="py-8 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <Stack gap={6}>
            <PageHeader
              icon={PlusCircle}
              eyebrow="Professional"
              title="List a Service, Business, Tutor or Property"
              description="What are you listing? You can change this on the next step."
            />
            {limitNotice}
            <Stack gap={3}>
              {KIND_CHOICES.map((choice) => {
                const Icon = choice.icon
                return (
                  <button
                    key={choice.value}
                    type="button"
                    onClick={() => {
                      setKind(choice.value)
                      setLocation(DEFAULT_LOCATION[choice.value])
                    }}
                    className="group glass-panel flex items-center gap-4 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
                      <Icon className="size-6" aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <Typography as="span" variant="label" className="font-heading text-base font-semibold">
                        {choice.title}
                      </Typography>
                      <Typography as="span" variant="body-sm" className="text-muted-foreground">
                        {choice.description}
                      </Typography>
                    </span>
                    <ArrowRight
                      className="size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                      aria-hidden="true"
                    />
                  </button>
                )
              })}
            </Stack>
          </Stack>
        </div>
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
        setLocationErrors(friendlyFieldErrors(error))
      }
    }
  }

  const errorCopy = createMutation.status === "error" ? userMessageFor(createMutation.error, "create-listing") : null

  const formProps = {
    onBack: () => setKind(null),
    onSubmit: submit,
    submitting: createMutation.pending,
  }

  const kindChoice = KIND_CHOICES.find((c) => c.value === kind)!

  return (
    <Container className="py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Stack gap={6}>
          <PageHeader
            icon={kindChoice.icon}
            eyebrow={`Professional · ${kindChoice.title}`}
            title="List a Service, Business, Tutor or Property"
            description="Everything you submit is reviewed before it is public."
          />

          {limitNotice}

          {errorCopy && (
            <FormAlert tone="error" title={errorCopy.title} description={errorCopy.description} />
          )}

          {kind === "tutor" && <TutorGradeField value={grade} onChange={setGrade} error={gradeError} disabled={createMutation.pending} />}

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
      </div>
    </Container>
  )
}

export { ListingFormPage }

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { ArrowLeft, Wrench, Building2, KeyRound } from "lucide-react"
import type { ListingKind } from "@/types/listing"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { ProviderCard } from "@/components/cards/ProviderCard"
import { BusinessCard } from "@/components/cards/BusinessCard"
import { PropertyCard } from "@/components/cards/PropertyCard"
import { ListingForm } from "@/features/provider/ListingForm"
import { PropertyListingForm } from "@/features/provider/PropertyListingForm"
import type { ListingFormValues, PropertyFormValues } from "@/features/provider/listingSchema"
import { buildProvider, buildBusiness, buildProperty } from "@/features/provider/listingBuilders"
import { useListingsStore } from "@/state/listingsStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

type Step = "type" | "form" | "preview"
type FormValues = ListingFormValues | PropertyFormValues

const typeChoices: { kind: ListingKind; icon: typeof Wrench; title: string; description: string }[] = [
  {
    kind: "provider",
    icon: Wrench,
    title: "Service / Professional",
    description: "Construction, electrical, solar and other home-service categories.",
  },
  {
    kind: "business",
    icon: Building2,
    title: "Business / Shop",
    description: "Pharmacies, salons, grocery stores and other local businesses.",
  },
  {
    kind: "property",
    icon: KeyRound,
    title: "Property",
    description: "Houses, flats and plots for sale or rent.",
  },
]

/** Create Listing (UI/UX Spec §18) — Choose Type → Form → Preview → Submit, one screen. */
function ListingFormPage() {
  const user = useRequireAuth()
  const navigate = useNavigate()
  const { submitListing } = useListingsStore()
  const [draftId] = useState(() => crypto.randomUUID())

  const [step, setStep] = useState<Step>("type")
  const [kind, setKind] = useState<ListingKind | null>(null)
  const [values, setValues] = useState<FormValues | null>(null)

  if (!user) return null

  function handleChooseType(nextKind: ListingKind) {
    setKind(nextKind)
    setStep("form")
  }

  function handleFormSubmit(nextValues: FormValues) {
    setValues(nextValues)
    setStep("preview")
  }

  function handleFinalSubmit() {
    if (!kind || !values || !user) return
    const base = {
      id: draftId,
      status: "pending" as const,
      submittedAt: new Date().toISOString(),
      submittedBy: user.name,
    }
    if (kind === "provider") {
      submitListing({ ...base, kind: "provider", data: buildProvider(values as ListingFormValues, draftId) })
    } else if (kind === "business") {
      submitListing({ ...base, kind: "business", data: buildBusiness(values as ListingFormValues, draftId) })
    } else {
      submitListing({ ...base, kind: "property", data: buildProperty(values as PropertyFormValues, draftId) })
    }
    navigate(routes.listingPending)
  }

  const previewProperty =
    step === "preview" && kind === "property" && values ? buildProperty(values as PropertyFormValues, draftId) : null

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-xl">
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">List Your Business / Service / Property</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              A few quick details, then submit for review.
            </Typography>
          </Stack>

          {step === "type" && (
            <Stack gap={3}>
              {typeChoices.map(({ kind: choiceKind, icon: Icon, title, description }) => (
                <button
                  key={choiceKind}
                  type="button"
                  onClick={() => handleChooseType(choiceKind)}
                  className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 text-left shadow-subtle transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <Stack gap={1}>
                    <Typography variant="label">{title}</Typography>
                    <Typography variant="body-sm" className="text-muted-foreground">
                      {description}
                    </Typography>
                  </Stack>
                </button>
              ))}
            </Stack>
          )}

          {step === "form" && kind === "property" && (
            <PropertyListingForm
              defaultValues={(values as PropertyFormValues) ?? undefined}
              onBack={() => setStep("type")}
              onSubmit={handleFormSubmit}
            />
          )}

          {step === "form" && (kind === "provider" || kind === "business") && (
            <ListingForm
              kind={kind}
              defaultValues={(values as ListingFormValues) ?? undefined}
              onBack={() => setStep("type")}
              onSubmit={handleFormSubmit}
            />
          )}

          {step === "preview" && kind && values && (
            <Stack gap={4}>
              <Stack direction="row" align="center" justify="between" gap={2}>
                <Typography variant="label">Preview</Typography>
                <DemoBadge label="Demo Preview" />
              </Stack>

              <div aria-hidden={false}>
                {kind === "provider" && <ProviderCard provider={buildProvider(values as ListingFormValues, draftId)} />}
                {kind === "business" && <BusinessCard business={buildBusiness(values as ListingFormValues, draftId)} />}
                {kind === "property" && previewProperty && <PropertyCard property={previewProperty} />}
              </div>

              {previewProperty && (previewProperty.propertyType || previewProperty.furnished) && (
                <Typography variant="body-sm" className="text-muted-foreground">
                  {previewProperty.propertyType}
                  {previewProperty.furnished ? ` · ${previewProperty.furnished}` : ""}
                </Typography>
              )}

              <Typography variant="caption" className="text-muted-foreground">
                This is how your listing will appear once approved. It is not yet published or
                visible to other residents.
              </Typography>

              <Stack gap={2} className="flex-col-reverse sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setStep("form")}>
                  <ArrowLeft />
                  Edit
                </Button>
                <Button type="button" onClick={handleFinalSubmit}>
                  Submit for Review
                </Button>
              </Stack>
            </Stack>
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ListingFormPage }

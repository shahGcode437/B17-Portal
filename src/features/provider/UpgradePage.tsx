import { CheckCircle2, Circle } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Card } from "@/components/ui/card"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { usePlanEntitlements } from "@/hooks/useCapability"
import { PLAN_ENTITLEMENTS } from "@/config/plans"
import { fadeUp } from "@/lib/motion"
import { motion } from "motion/react"
import type { Capability, Plan } from "@/types/entitlements"

const CAPABILITY_LABELS: Record<Capability, string> = {
  "profile.basic": "Professional profile",
  "listings.basic": "Create & manage listings",
  "leads.basic": "Receive & manage leads",
  "listings.extended": "Higher listing limit",
  "analytics.basic": "Listings & leads analytics",
  "professional.modules": "Profession-specific modules (coming later)",
}

function limitLabel(maxListings: number | null): string {
  return maxListings === null ? "Unlimited listings" : `Up to ${maxListings} listings`
}

function PlanColumn({ plan, current }: { plan: Plan; current: boolean }) {
  const entitlements = PLAN_ENTITLEMENTS[plan]
  return (
    <Card variant="workspace" className={`gap-3 p-5 ${current ? "border-primary bg-primary/5" : ""}`}>
      <Stack direction="row" align="center" justify="between">
        <Typography as="h2" variant="h3" className="capitalize">
          {plan}
        </Typography>
        {current && (
          <Typography variant="caption" className="font-medium text-primary">
            Current plan
          </Typography>
        )}
      </Stack>
      <Typography variant="body-sm" className="text-muted-foreground">
        {limitLabel(entitlements.maxListings)}
      </Typography>
      <Stack gap={2}>
        {entitlements.capabilities.map((capability) => (
          <Stack key={capability} direction="row" align="center" gap={2}>
            <CheckCircle2 className="size-4 shrink-0 text-success-text" aria-hidden="true" />
            <Typography variant="body-sm">
              <span className="sr-only">Included: </span>
              {CAPABILITY_LABELS[capability]}
            </Typography>
          </Stack>
        ))}
        {plan === "free" &&
          (["listings.extended", "analytics.basic", "professional.modules"] as Capability[]).map((capability) => (
            <Stack key={capability} direction="row" align="center" gap={2} className="text-muted-foreground">
              <Circle className="size-4 shrink-0" aria-hidden="true" />
              <Typography variant="body-sm">
                <span className="sr-only">Not included: </span>
                {CAPABILITY_LABELS[capability]}
              </Typography>
            </Stack>
          ))}
      </Stack>
    </Card>
  )
}

/**
 * Upgrade / plan comparison (Phase 9E). No pricing, no payment button, no checkout flow - there is
 * no billing system yet (Master Spec / DECISIONS.md: billing is explicitly deferred). Since Phase
 * 12G the plan shown is the one the SERVER reports for the account; the old local demo switch is gone
 * because it could only ever have shown a plan the server does not enforce.
 */
function UpgradePage() {
  const user = useRequireAuth()
  const { plan } = usePlanEntitlements()

  if (!user) return null

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">Free & Premium</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Compare what each plan includes in the Professional Workspace.
            </Typography>
          </Stack>

          <Grid cols={2} gap={4}>
            <PlanColumn plan="free" current={plan === "free"} />
            <PlanColumn plan="premium" current={plan === "premium"} />
          </Grid>

          <Card variant="workspace" className="border-dashed shadow-none">
            <Stack gap={1}>
              <Typography variant="label">Changing your plan</Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                There is no payment or subscription yet, so a plan can't be changed from here. Your
                account is on the {plan === "premium" ? "Premium" : "Free"} plan.
              </Typography>
            </Stack>
          </Card>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { UpgradePage }

import { CheckCircle2, Circle } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Card } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useToast } from "@/hooks/useToast"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { usePlanStore } from "@/state/planStore"
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

function isPlan(value: string): value is Plan {
  return value === "free" || value === "premium"
}

function PlanColumn({ plan, current }: { plan: Plan; current: boolean }) {
  const entitlements = PLAN_ENTITLEMENTS[plan]
  return (
    <Card variant="workspace" className={`gap-3 p-5 ${current ? "border-primary bg-primary/5" : ""}`}>
      <Stack direction="row" align="center" justify="between">
        <Typography variant="h3" className="capitalize">
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
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
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
 * Upgrade / plan comparison (Phase 9E). No pricing, no payment button, no
 * checkout flow — there is no billing system yet (Master Spec / DECISIONS.md:
 * billing is explicitly deferred). The plan switch below is a demo-only
 * control (like the rest of this prototype's "(demo)" affordances — e.g.
 * demo login, simulated WhatsApp) so the capability system is actually
 * demonstrable without pretending a real subscription exists.
 */
function UpgradePage() {
  const user = useRequireAuth()
  const plan = usePlanStore((state) => state.plan)
  const setPlan = usePlanStore((state) => state.setPlan)
  const { show } = useToast()

  function handlePlanChange(next: string) {
    if (!isPlan(next)) return
    setPlan(next)
    show(next === "premium" ? "Switched to Premium (demo)" : "Switched to Free (demo)")
  }

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
              <Typography variant="label">Try it (demo)</Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                This is a prototype — there is no real payment or subscription. Use this switch to
                preview what Premium unlocks in your workspace.
              </Typography>
            </Stack>
            <ToggleGroup
              type="single"
              variant="outline"
              value={plan}
              onValueChange={handlePlanChange}
              aria-label="Switch demo plan"
              className="w-fit"
            >
              <ToggleGroupItem value="free" className="h-11 min-w-20 data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:font-semibold data-[state=on]:text-accent-foreground">Free</ToggleGroupItem>
              <ToggleGroupItem value="premium" className="h-11 min-w-20 data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:font-semibold data-[state=on]:text-accent-foreground">Premium</ToggleGroupItem>
            </ToggleGroup>
          </Card>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { UpgradePage }

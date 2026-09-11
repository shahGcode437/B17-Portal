import { ShoppingBag, Pill, Truck, Users, Wallet } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Badge } from "@/components/ui/badge"

const futureModules = [
  { label: "Marketplace", icon: ShoppingBag },
  { label: "Pharmacy", icon: Pill },
  { label: "Pick & Drop", icon: Truck },
  { label: "Community", icon: Users },
  { label: "B-17 Vault", icon: Wallet },
]

/**
 * Future modules teaser (Master Spec §7). Intentionally non-interactive —
 * these are labeled Coming Soon rather than linking to a fake flow, so
 * there is no dead-button affordance.
 */
function FutureModules() {
  return (
    <Container className="py-12 sm:py-16">
      <SectionHeader
        title="What's Next for B-17 Portal"
        description="Future modules on the roadmap — not part of this prototype."
      />
      <Grid cols={5} gap={4}>
        {futureModules.map(({ label, icon: Icon }) => (
          <Stack
            key={label}
            align="center"
            gap={2}
            className="rounded-xl border border-dashed border-border bg-muted/40 p-5 text-center"
          >
            <span className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <Typography variant="label">{label}</Typography>
            <Badge variant="secondary" className="font-normal">
              Coming Soon
            </Badge>
          </Stack>
        ))}
      </Grid>
    </Container>
  )
}

export { FutureModules }

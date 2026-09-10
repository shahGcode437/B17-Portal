import { Wrench, Building2, GraduationCap, KeyRound } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Grid } from "@/components/foundation/Grid"
import { Typography } from "@/components/foundation/Typography"
import { site } from "@/data/site"

const quickLinks = [
  { label: "Services", icon: Wrench },
  { label: "Business Directory", icon: Building2 },
  { label: "Education", icon: GraduationCap },
  { label: "Property", icon: KeyRound },
]

/**
 * Phase 1 placeholder Home — proves the shell/layout/token system renders
 * correctly end to end. The full search-first Homepage (Prototype Scope §7,
 * UI/UX Spec §7) is built in Phase 2.
 */
function HomePage() {
  return (
    <Container className="py-16 sm:py-24">
      <Stack align="center" gap={4} className="mx-auto max-w-2xl text-center">
        <Typography variant="display">{site.name}</Typography>
        <Typography variant="body-lg" className="text-muted-foreground">
          {site.tagline}
        </Typography>
      </Stack>

      <Grid cols={4} gap={4} className="mx-auto mt-12 max-w-3xl">
        {quickLinks.map(({ label, icon: Icon }) => (
          <Stack
            key={label}
            align="center"
            gap={2}
            className="rounded-xl border border-border bg-card p-6 text-center shadow-subtle"
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <Typography variant="label">{label}</Typography>
          </Stack>
        ))}
      </Grid>
    </Container>
  )
}

export { HomePage }

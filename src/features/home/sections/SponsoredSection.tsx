import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { FeaturedCard } from "@/components/cards/FeaturedCard"
import { sponsoredCards } from "@/data/sponsored"

/** Sponsored/Featured placement demo (Master Spec §7 — not a real advertiser). */
function SponsoredSection() {
  return (
    <Container className="py-12 sm:py-16">
      <SectionHeader
        title="Featured & Sponsored"
        description="A preview of how sponsored placements will appear on B-17 Portal."
      />
      <Grid cols={2} gap={4}>
        {sponsoredCards.map((sponsored) => (
          <FeaturedCard key={sponsored.id} sponsored={sponsored} />
        ))}
      </Grid>
    </Container>
  )
}

export { SponsoredSection }

import { Megaphone } from "lucide-react"
import { motion } from "motion/react"
import type { SponsoredCard } from "@/types/sponsored"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { Badge } from "@/components/ui/badge"
import { cardHover } from "@/lib/motion"

interface FeaturedCardProps {
  sponsored: SponsoredCard
}

/**
 * Sponsored/featured placement (Master Spec §11 "Sponsored"). Always
 * clearly labeled — never implies a real advertiser (UI/UX Spec §26).
 */
function FeaturedCard({ sponsored }: FeaturedCardProps) {
  return (
    <motion.div
      {...cardHover}
      className="flex flex-col gap-3 rounded-xl border border-dashed border-brand-accent/40 bg-brand-accent/5 p-3 shadow-subtle"
    >
      <CardImage src={sponsored.image} icon={Megaphone} label={sponsored.title} tone="accent" />
      <Stack gap={2} className="px-1 pb-1">
        <Badge className="w-fit gap-1 bg-brand-accent text-brand-accent-foreground">
          <Megaphone className="size-3" aria-hidden="true" />
          Sponsored
        </Badge>
        <Typography variant="label" className="text-base">
          {sponsored.title}
        </Typography>
        <Typography variant="body-sm" className="text-muted-foreground">
          {sponsored.description}
        </Typography>
      </Stack>
    </motion.div>
  )
}

export { FeaturedCard }

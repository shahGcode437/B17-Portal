import { Star } from "lucide-react"
import { Badge } from "@/components/ui/badge"

/** "Featured" chip — only render it where the item's own `featured` flag is true; never a default. */
function FeaturedBadge() {
  return (
    <Badge className="gap-1 bg-brand-accent text-brand-accent-foreground">
      <Star className="size-3" aria-hidden="true" />
      Featured
    </Badge>
  )
}

export { FeaturedBadge }

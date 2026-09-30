import { Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { usePlanEntitlements } from "@/hooks/useCapability"

/** Plan indicator (Phase 9E) — text always present ("Free"/"Premium"), never color-only. */
function PlanBadge() {
  const { plan } = usePlanEntitlements()
  return (
    <Badge
      variant={plan === "premium" ? "default" : "outline"}
      className="gap-1 font-normal capitalize"
    >
      {plan === "premium" && <Sparkles className="size-3" aria-hidden="true" />}
      {plan} plan
    </Badge>
  )
}

export { PlanBadge }

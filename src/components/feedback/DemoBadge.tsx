import { Badge } from "@/components/ui/badge"

/**
 * Standing disclaimer on every demo card (Master Spec §9, §19 — never
 * imply real verification; always make prototype data obvious).
 */
function DemoBadge({ label = "Demo Listing" }: { label?: string }) {
  return (
    <Badge variant="secondary" className="font-normal text-muted-foreground">
      {label}
    </Badge>
  )
}

export { DemoBadge }

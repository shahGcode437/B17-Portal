import { Typography } from "@/components/foundation/Typography"
import type { PrivateLocationView } from "@/types/ownerListing"

const VISIBILITY_COPY: Record<PrivateLocationView["visibility"], string> = {
  exact: "Shown on the map as an exact pin, with the address",
  approximate: "Shown to the public as an approximate area only",
  area_only: "Shown to the public as an area only (no map)",
}

/**
 * Where a listing is, as its OWNER or an ADMIN may see it: the visibility the public gets, plus the
 * address, landmark, block and the stored point. This is private data - it is only ever rendered in
 * the owner's own preview and the admin review, never on a public page.
 */
function OwnerLocationFacts({ location, area }: { location: PrivateLocationView; area: string }) {
  const rows: [string, string][] = [["Area", area]]
  if (location.block) rows.push(["Block", location.block])
  if (location.address) rows.push(["Address", location.address])
  if (location.landmark) rows.push(["Landmark", location.landmark])
  if (location.latitude !== undefined && location.longitude !== undefined) {
    rows.push(["Stored point", `${location.latitude}, ${location.longitude}`])
  }

  return (
    <section aria-label="Location" className="flex flex-col gap-2">
      <Typography as="h3" variant="label" className="text-xs">
        Location · {VISIBILITY_COPY[location.visibility]}
      </Typography>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg bg-muted p-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export { OwnerLocationFacts }

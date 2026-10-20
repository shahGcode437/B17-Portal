import { useEffect, useMemo, useRef, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"
import { mapOptionsFor } from "@/components/location/mapOptions"
import type { MapEngine, MapHandle, MapViewOptions } from "@/components/location/mapEngine"
import type { PublicLocation } from "@/types/location"

/** Loads the Leaflet engine on demand, so the map library is a chunk of its own. */
const loadLeafletEngine = (): Promise<MapEngine> =>
  import("@/components/location/leafletEngine").then((module) => module.leafletEngine)

interface MapViewProps {
  /** The PUBLIC location only: this component cannot be handed a private point. */
  location: PublicLocation
  /** The listing's name, for the accessible description. */
  label: string
  /** A different engine (tests pass a fake, so no Leaflet, canvas or network is involved). */
  engine?: MapEngine
  className?: string
}

type MapStatus = "loading" | "ready" | "failed"

/**
 * A read-only map of a public location (docs/backend/LOCATION_MAP.md §11). It is supplemental: the
 * text next to it (`LocationSection`) says everything the map shows. Area-only listings, listings
 * without a usable point and any location whose point disagrees with its visibility render NOTHING
 * (no empty or fake map). The map never takes keyboard focus away, never captures the scroll wheel
 * and shows attribution at all times.
 */
function MapView({ location, label, engine, className }: MapViewProps) {
  const options = useMemo(
    () => mapOptionsFor(location, label),
    // The options depend on these primitives only; a new `location` object with the same values must not remount the map.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [
      location.visibility,
      location.coordinates?.latitude,
      location.coordinates?.longitude,
      location.coordinates?.precision,
      label,
    ]
  )
  const container = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<{ options: MapViewOptions; value: MapStatus } | null>(null)
  const mode = location.visibility

  useEffect(() => {
    const element = container.current
    if (!element || !options) return
    let cancelled = false
    let handle: MapHandle | undefined
    Promise.resolve(engine ?? loadLeafletEngine()).then(
      (resolved) => {
        if (cancelled) return
        try {
          handle = resolved.mount(element, options)
          setStatus({ options, value: "ready" })
        } catch {
          setStatus({ options, value: "failed" })
        }
      },
      () => {
        if (!cancelled) setStatus({ options, value: "failed" })
      }
    )
    return () => {
      cancelled = true
      handle?.destroy()
    }
  }, [engine, options])

  if (!options) return null
  const current: MapStatus = status && status.options === options ? status.value : "loading"

  return (
    <div
      role="group"
      aria-label={mode === "approximate" ? `Map of the approximate location of ${label}` : `Map of ${label}`}
      data-testid="location-map"
      data-map-mode={mode}
      data-map-status={current}
      className={cn("relative isolate overflow-hidden rounded-lg border border-border bg-muted", className)}
    >
      <div ref={container} className="h-56 w-full sm:h-72" />
      {current === "loading" && <Skeleton className="absolute inset-0 z-[500] rounded-none" aria-hidden="true" />}
      {current === "failed" && (
        <Typography
          variant="body-sm"
          role="status"
          className="absolute inset-0 z-[500] flex items-center justify-center bg-muted p-4 text-center text-muted-foreground"
        >
          The map could not be loaded. The location details above are still correct.
        </Typography>
      )}
    </div>
  )
}

export { MapView }

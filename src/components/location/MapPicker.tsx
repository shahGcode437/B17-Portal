import { useEffect, useMemo, useRef, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"
import {
  APPROXIMATE_CIRCLE_RADIUS_METERS,
  MAP_TILE_ATTRIBUTION,
  MAP_TILE_URL,
  MAP_ZOOM_APPROXIMATE,
  MAP_ZOOM_EXACT,
} from "@/config/map"
import type { MapHandle } from "@/components/location/mapEngine"
import type { PickerEngine, PickerOptions } from "@/components/location/leafletPickerEngine"

/**
 * Writable map (Phase 12H). Click anywhere to set the point; drag the pin to adjust. Reports back
 * through `onChange`. Used only inside the listing form picker — the public map is `MapView`.
 *
 * `area_only` renders nothing (no empty map), `approximate` draws an illustrative circle plus the
 * draggable pin, `exact` draws the pin alone. The engine is lazy-loaded so Leaflet never ships on a
 * route that does not draw a map.
 */
type Mode = "exact" | "approximate"

interface MapPickerProps {
  mode: Mode
  /** `null` = no point chosen yet; the picker centres on `defaultCenter`. */
  value: { latitude: number; longitude: number } | null
  onChange: (point: { latitude: number; longitude: number }) => void
  /** The listing's name, for the pin's accessible label. */
  label: string
  /** B-17 default centre when the owner has not placed a point yet. */
  defaultCenter?: { latitude: number; longitude: number }
  /** A different engine (tests pass a fake, so no Leaflet, canvas or network). */
  engine?: PickerEngine
  className?: string
}

/** Rough centre of B-17 (used only for the initial pan when there is no point yet). */
const B17_CENTER = { latitude: 33.7, longitude: 73.05 }

const loadPickerEngine = () =>
  import("@/components/location/leafletPickerEngine").then((module) => module.leafletPickerEngine)

function MapPicker({ mode, value, onChange, label, defaultCenter = B17_CENTER, engine, className }: MapPickerProps) {
  const options = useMemo((): PickerOptions => {
    const center = value ?? defaultCenter
    return {
      center,
      zoom: mode === "exact" ? MAP_ZOOM_EXACT : MAP_ZOOM_APPROXIMATE,
      tileUrl: MAP_TILE_URL,
      attribution: MAP_TILE_ATTRIBUTION,
      ...(value
        ? {
            marker: { position: value, label: `${label} location` },
            ...(mode === "approximate"
              ? { circle: { center: value, radiusMeters: APPROXIMATE_CIRCLE_RADIUS_METERS } }
              : {}),
          }
        : {}),
      draggable: value !== null,
      onPick: onChange,
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, value?.latitude, value?.longitude, label, defaultCenter.latitude, defaultCenter.longitude, onChange])

  const container = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState<"loading" | "ready" | "failed">("loading")

  useEffect(() => {
    const element = container.current
    if (!element) return
    let cancelled = false
    let handle: MapHandle | undefined
    Promise.resolve(engine ?? loadPickerEngine()).then(
      (resolved) => {
        if (cancelled) return
        try {
          handle = resolved.mount(element, options)
          setReady("ready")
        } catch {
          setReady("failed")
        }
      },
      () => {
        if (!cancelled) setReady("failed")
      }
    )
    return () => {
      cancelled = true
      handle?.destroy()
    }
  }, [engine, options])

  return (
    <div
      role="group"
      aria-label={`Pick ${label} location on the map`}
      data-testid="map-picker"
      data-map-status={ready}
      className={cn("relative isolate overflow-hidden rounded-lg border border-border bg-muted", className)}
    >
      <div ref={container} className="h-56 w-full sm:h-72" />
      {ready === "loading" && <Skeleton className="absolute inset-0 z-[500] rounded-none" aria-hidden="true" />}
      {ready === "failed" && (
        <Typography
          variant="body-sm"
          role="status"
          className="absolute inset-0 z-[500] flex items-center justify-center bg-muted p-4 text-center text-muted-foreground"
        >
          The map could not be loaded. You can still enter numeric coordinates below.
        </Typography>
      )}
    </div>
  )
}

export { MapPicker }

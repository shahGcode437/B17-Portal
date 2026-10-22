import { useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { MapPicker } from "@/components/location/MapPicker"
import { selectClassName } from "@/features/provider/formStyles"
import { isValidCoordinate } from "@/lib/api/adapters"
import type { LocationWrite } from "@/lib/api/writes/listings"

interface LocationFieldsetProps {
  value: LocationWrite
  onChange: (next: LocationWrite) => void
  /** `name` or `title` of the listing, for the picker's accessible label. */
  itemLabel: string
  /** Which kinds are allowed. Property forbids `area_only`; provider / tutor default to `area_only`. */
  allowedVisibilities: ReadonlyArray<"exact" | "approximate" | "area_only">
  /** Field errors from a `422` the server returned, keyed by `location.*`. */
  errors?: Record<string, string>
  /** True while the picker should be hidden (e.g. the whole form is submitting). */
  disabled?: boolean
}

const VISIBILITY_LABELS: Record<"exact" | "approximate" | "area_only", string> = {
  exact: "Exact location (shown with address and a pin)",
  approximate: "Approximate (an area around the pin is shown; no address)",
  area_only: "Area only (no map, no pin — just the area name)",
}

/**
 * Writable location block for every listing form (Phase 12H). It writes a `LocationWrite` as a
 * whole: switching the visibility clears or keeps fields the backend demands, so the payload never
 * carries a point for `area_only` (API_CONTRACT §10.6, LOCATION_MAP §8).
 *
 *  - `exact`: picker + address + optional landmark + block.
 *  - `approximate`: picker (circle, dragged pin stays private) + block; address / landmark hidden
 *    because the backend forbids them.
 *  - `area_only`: block + area only; the picker is replaced by text ("Location shared at area level").
 *
 * Property is enforced upstream: `allowedVisibilities` omits `area_only`.
 */
function LocationFieldset({ value, onChange, itemLabel, allowedVisibilities, errors = {}, disabled }: LocationFieldsetProps) {
  const [latText, setLatText] = useState(value.latitude !== undefined ? String(value.latitude) : "")
  const [lngText, setLngText] = useState(value.longitude !== undefined ? String(value.longitude) : "")

  const setVisibility = (visibility: "exact" | "approximate" | "area_only") => {
    if (visibility === "area_only") {
      // area_only accepts the block only; strip point / address / landmark so the backend never 422s.
      onChange({ visibility, ...(value.block ? { block: value.block } : {}) })
      setLatText("")
      setLngText("")
      return
    }
    if (visibility === "approximate") {
      // Approximate keeps the point but drops the address / landmark (public pages never show them).
      const next: LocationWrite = { visibility, ...(value.block ? { block: value.block } : {}) }
      if (value.latitude !== undefined && value.longitude !== undefined) {
        next.latitude = value.latitude
        next.longitude = value.longitude
      }
      onChange(next)
      return
    }
    onChange({ ...value, visibility })
  }

  const commitPoint = (latitude: number, longitude: number) => {
    setLatText(String(latitude))
    setLngText(String(longitude))
    onChange({ ...value, latitude, longitude })
  }

  const commitTypedPoint = () => {
    const lat = Number(latText)
    const lng = Number(lngText)
    if (isValidCoordinate(lat, lng)) commitPoint(Number(lat.toFixed(6)), Number(lng.toFixed(6)))
  }

  const needsPoint = value.visibility === "exact" || value.visibility === "approximate"
  const needsAddress = value.visibility === "exact"
  const point = value.latitude !== undefined && value.longitude !== undefined ? { latitude: value.latitude, longitude: value.longitude } : null

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" aria-label="Location">
      <legend className="text-sm font-medium">Where is this listing?</legend>

      <Stack gap={2}>
        <Label htmlFor="location-visibility">Visibility</Label>
        <select
          id="location-visibility"
          className={selectClassName}
          value={value.visibility}
          disabled={disabled}
          onChange={(e) => setVisibility(e.target.value as "exact" | "approximate" | "area_only")}
        >
          {allowedVisibilities.map((v) => (
            <option key={v} value={v}>
              {VISIBILITY_LABELS[v]}
            </option>
          ))}
        </select>
        {errors["location.visibility"] && (
          <Typography variant="caption" className="text-destructive" role="alert">
            {errors["location.visibility"]}
          </Typography>
        )}
      </Stack>

      <Stack gap={2}>
        <Label htmlFor="location-block">Block (optional)</Label>
        <Input
          id="location-block"
          placeholder="e.g. C"
          value={value.block ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, block: e.target.value || undefined })}
          aria-invalid={!!errors["location.block"]}
        />
        {errors["location.block"] && (
          <Typography variant="caption" className="text-destructive" role="alert">
            {errors["location.block"]}
          </Typography>
        )}
      </Stack>

      {needsAddress && (
        <>
          <Stack gap={2}>
            <Label htmlFor="location-address">Street address</Label>
            <Textarea
              id="location-address"
              rows={2}
              placeholder="e.g. Shop 4, Demo Plaza"
              value={value.address ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, address: e.target.value || undefined })}
              aria-invalid={!!errors["location.address"]}
            />
            {errors["location.address"] && (
              <Typography variant="caption" className="text-destructive" role="alert">
                {errors["location.address"]}
              </Typography>
            )}
          </Stack>
          <Stack gap={2}>
            <Label htmlFor="location-landmark">Landmark (optional)</Label>
            <Input
              id="location-landmark"
              placeholder="e.g. Next to the park"
              value={value.landmark ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, landmark: e.target.value || undefined })}
              aria-invalid={!!errors["location.landmark"]}
            />
          </Stack>
        </>
      )}

      {value.visibility === "approximate" && (
        <Typography variant="body-sm" className="text-muted-foreground">
          The map shows only an approximate area to the public. Your exact point is kept private.
        </Typography>
      )}

      {needsPoint ? (
        <>
          <MapPicker
            mode={value.visibility === "exact" ? "exact" : "approximate"}
            value={point}
            onChange={({ latitude, longitude }) => commitPoint(Number(latitude.toFixed(6)), Number(longitude.toFixed(6)))}
            label={itemLabel || "This listing"}
          />
          <Typography variant="caption" className="text-muted-foreground">
            Tap the map to drop a pin. Drag the pin to adjust. Or enter numeric coordinates below.
          </Typography>
          <Stack direction="row" gap={2} className="flex-col sm:flex-row">
            <Stack gap={1} className="flex-1 min-w-0">
              <Label htmlFor="location-latitude">Latitude</Label>
              <Input
                id="location-latitude"
                inputMode="decimal"
                placeholder="33.7012"
                value={latText}
                disabled={disabled}
                onChange={(e) => setLatText(e.target.value)}
                onBlur={commitTypedPoint}
                aria-invalid={!!errors["location.latitude"]}
              />
            </Stack>
            <Stack gap={1} className="flex-1 min-w-0">
              <Label htmlFor="location-longitude">Longitude</Label>
              <Input
                id="location-longitude"
                inputMode="decimal"
                placeholder="73.0512"
                value={lngText}
                disabled={disabled}
                onChange={(e) => setLngText(e.target.value)}
                onBlur={commitTypedPoint}
                aria-invalid={!!errors["location.longitude"]}
              />
            </Stack>
          </Stack>
          {(errors["location.latitude"] || errors["location.longitude"] || errors["location.coordinates"]) && (
            <Typography variant="caption" className="text-destructive" role="alert">
              {errors["location.latitude"] || errors["location.longitude"] || errors["location.coordinates"]}
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body-sm" className="text-muted-foreground">
          Location shared at area level. No map or pin is shown to the public.
        </Typography>
      )}
    </fieldset>
  )
}

export { LocationFieldset }

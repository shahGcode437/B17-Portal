import { useState } from "react"
import { Eye, MapPin as MapPinIcon } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { FieldError } from "@/components/forms/FieldError"
import { FormSection } from "@/components/forms/FormSection"
import { MapPicker } from "@/components/location/MapPicker"
import { selectClassName } from "@/features/provider/formStyles"
import { isValidCoordinate } from "@/lib/api/adapters"
import { MAX_ADDRESS_LENGTH, MAX_LANDMARK_LENGTH } from "@/config/listingLimits"
import { MAX_BLOCK_LENGTH, addressProblem, blockProblem, landmarkProblem } from "@/features/provider/locationRules"
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

const VISIBILITY_PUBLIC_PREVIEW: Record<"exact" | "approximate" | "area_only", string> = {
  exact: "Visitors see the exact address, a pin on the map and Get Directions.",
  approximate: "Visitors see an illustrative area on the map. Your exact point and address are kept hidden.",
  area_only: "Visitors see only the area name. No map, no pin, no address.",
}

/**
 * Writable location block for every listing form (Phase 12H). It writes a `LocationWrite` as a
 * whole, so the payload never carries a point for `area_only` (API_CONTRACT §10.6, LOCATION_MAP §8).
 *
 *  - `exact`: picker + address (required) + optional landmark + block.
 *  - `approximate`: picker (circle, dragged pin stays private) + block. An address / landmark entered
 *    earlier is kept as private data (it is only ever public for `exact`) - see `setVisibility`.
 *  - `area_only`: block + area only; the picker is replaced by text ("Location shared at area level").
 *
 * Property is enforced upstream: `allowedVisibilities` omits `area_only`.
 */
function LocationFieldset({ value, onChange, itemLabel, allowedVisibilities, errors = {}, disabled }: LocationFieldsetProps) {
  const [latText, setLatText] = useState(value.latitude !== undefined ? String(value.latitude) : "")
  const [lngText, setLngText] = useState(value.longitude !== undefined ? String(value.longitude) : "")

  // Changing the visibility discards ONLY what the new mode technically cannot hold: `area_only`
  // stores no point. Block, address and landmark are KEPT - for `approximate` / `area_only` they stay
  // private (never public, never in the search document). Clearing them would make a privacy narrowing
  // a content change, which goes back to moderation and takes the listing offline instead of taking
  // effect at once (LOCATION_MAP.md §7.4).
  const setVisibility = (visibility: "exact" | "approximate" | "area_only") => {
    if (visibility === "area_only") {
      const { latitude: _latitude, longitude: _longitude, ...withoutPoint } = value
      onChange({ ...withoutPoint, visibility })
      setLatText("")
      setLngText("")
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

  // The server's own message wins (it arrives after a submit); until then the same rule is checked as the owner types.
  const blockError = errors["location.block"] ?? blockProblem(value.block)
  const addressError = errors["location.address"] ?? addressProblem(value.address)
  const landmarkError = errors["location.landmark"] ?? landmarkProblem(value.landmark)

  const needsPoint = value.visibility === "exact" || value.visibility === "approximate"
  const needsAddress = value.visibility === "exact"
  const point = value.latitude !== undefined && value.longitude !== undefined ? { latitude: value.latitude, longitude: value.longitude } : null

  return (
    <FormSection
      icon={MapPinIcon}
      title="Where is this listing?"
      description="You control how precisely the public sees it. The map and address are hidden whenever the visibility doesn't allow them."
    >
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
        <FieldError id="location-visibility-error" message={errors["location.visibility"]} />
        <Typography
          variant="body-sm"
          className="flex items-start gap-2 rounded-lg bg-info/10 px-3 py-2 text-info-text ring-1 ring-info/25"
        >
          <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 text-foreground">
            <span className="font-semibold">The public sees:</span> {VISIBILITY_PUBLIC_PREVIEW[value.visibility]}
          </span>
        </Typography>
      </Stack>

      <Stack gap={2}>
        <Label htmlFor="location-block">Block (optional)</Label>
        <Input
          id="location-block"
          placeholder="e.g. C or Block C"
          maxLength={MAX_BLOCK_LENGTH}
          value={value.block ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, block: e.target.value || undefined })}
          aria-invalid={!!blockError}
          aria-describedby={blockError ? "location-block-error" : "location-block-hint"}
        />
        {blockError ? (
          <FieldError id="location-block-error" message={blockError} />
        ) : (
          <Typography id="location-block-hint" variant="caption" className="text-muted-foreground">
            Your block or sector within B-17. The area itself is always B-17.
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
              placeholder="e.g. Shop 4, Main Market"
              value={value.address ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, address: e.target.value || undefined })}
              maxLength={MAX_ADDRESS_LENGTH}
              aria-invalid={!!addressError}
              aria-describedby={addressError ? "location-address-error" : undefined}
            />
            <FieldError id="location-address-error" message={addressError} />
          </Stack>
          <Stack gap={2}>
            <Label htmlFor="location-landmark">Landmark (optional)</Label>
            <Input
              id="location-landmark"
              placeholder="e.g. Next to the park"
              value={value.landmark ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, landmark: e.target.value || undefined })}
              maxLength={MAX_LANDMARK_LENGTH}
              aria-invalid={!!landmarkError}
              aria-describedby={landmarkError ? "location-landmark-error" : undefined}
            />
            <FieldError id="location-landmark-error" message={landmarkError} />
          </Stack>
        </>
      )}

      {value.visibility !== "exact" && (value.address || value.landmark) && (
        <Typography variant="body-sm" className="text-muted-foreground">
          The address and landmark you entered stay private: they are never shown to the public.
        </Typography>
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
          <FieldError
            id="location-point-error"
            message={errors["location.latitude"] || errors["location.longitude"] || errors["location.coordinates"]}
          />
        </>
      ) : (
        <Typography variant="body-sm" className="text-muted-foreground">
          Location shared at area level. No map or pin is shown to the public.
        </Typography>
      )}
    </FormSection>
  )
}

export { LocationFieldset }

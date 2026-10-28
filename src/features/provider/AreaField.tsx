import type { UseFormRegisterReturn } from "react-hook-form"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Label } from "@/components/ui/label"
import { selectClassName } from "@/features/provider/formStyles"
import { DEFAULT_LOCALITY, LOCALITIES } from "@/config/localities"

interface AreaFieldProps {
  id: string
  inputProps: UseFormRegisterReturn
  error?: string
  /** An edit of an old listing whose stored area is not one of the configured localities (free text from before S4). */
  legacyArea?: string | null
}

/**
 * The listing's `area` (Phase 12S, S4). It is a choice from the configured localities, never free text: the
 * backend accepts only a canonical locality (`422 unknown_locality` for "Islamabad" or "B-17 Block C"), and the
 * block / street goes in the separate Block field of the location section. Today the list is just B-17.
 */
function AreaField({ id, inputProps, error, legacyArea }: AreaFieldProps) {
  const describedBy = [error ? `${id}-error` : null, `${id}-hint`].filter(Boolean).join(" ")
  return (
    <Stack gap={2}>
      <Label htmlFor={id}>Area</Label>
      <select
        id={id}
        className={selectClassName}
        defaultValue={DEFAULT_LOCALITY}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        {...inputProps}
      >
        {LOCALITIES.map((locality) => (
          <option key={locality} value={locality}>
            {locality}
          </option>
        ))}
      </select>
      {error && (
        <Typography id={`${id}-error`} variant="caption" className="text-destructive" role="alert">
          {error}
        </Typography>
      )}
      <Typography id={`${id}-hint`} variant="caption" className="text-muted-foreground">
        {LOCALITIES.length === 1 ? `Listings are for ${DEFAULT_LOCALITY} for now.` : "Choose where the listing is."} Add your
        block or street under “Where is this listing?”.
        {legacyArea ? ` The area on file (“${legacyArea}”) will be saved as ${DEFAULT_LOCALITY}.` : ""}
      </Typography>
    </Stack>
  )
}

export { AreaField }

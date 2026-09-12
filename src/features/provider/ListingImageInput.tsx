import { useRef, useState } from "react"
import { ImagePlus, X } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"]

interface ListingImageInputProps {
  id: string
  /** A browser-local object URL (from a prior selection), or undefined if none chosen. */
  value?: string
  onChange: (value: string | undefined) => void
}

/**
 * Optional listing image picker shared by Service/Business/Property
 * onboarding (Onboarding Fix §7). Prototype-only: creates a browser-local
 * `URL.createObjectURL()` preview for this session — nothing is uploaded,
 * no backend or cloud storage is involved, and the domain data only ever
 * stores the resulting string, never a File object. The previous object URL
 * is revoked whenever it's replaced or removed so a single edit session
 * doesn't leak blob URLs; the URL kept at submit time is left alone since it
 * needs to keep working for the rest of the browser session (Dashboard,
 * Moderation, Search, Detail page).
 */
function ListingImageInput({ id, value, onChange }: ListingImageInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Please choose a JPG, PNG or WEBP image.")
      return
    }

    setError(null)
    const nextUrl = URL.createObjectURL(file)
    if (value) URL.revokeObjectURL(value)
    onChange(nextUrl)
  }

  function handleRemove() {
    if (value) URL.revokeObjectURL(value)
    onChange(undefined)
  }

  return (
    <Stack gap={2}>
      <Typography variant="label" id={`${id}-label`}>
        Listing Image
      </Typography>

      {value && (
        <img
          src={value}
          alt="Preview of the selected listing image"
          className="aspect-video w-full rounded-lg object-cover"
        />
      )}

      <Stack direction="row" gap={2}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          aria-describedby={error ? `${id}-error` : undefined}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus />
          Choose Image
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={handleRemove}>
            <X />
            Remove
          </Button>
        )}
      </Stack>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        aria-labelledby={`${id}-label`}
        onChange={handleFileChange}
      />

      {error && (
        <Typography id={`${id}-error`} variant="caption" className="text-destructive" role="alert">
          {error}
        </Typography>
      )}
      <Typography variant="caption" className="text-muted-foreground">
        Optional. This is a prototype preview only — no image is uploaded anywhere.
      </Typography>
    </Stack>
  )
}

export { ListingImageInput }

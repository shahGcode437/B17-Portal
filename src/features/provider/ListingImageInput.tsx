import { ImagePlus, X } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"

interface ListingImageInputProps {
  id: string
  /** The image already on file for this listing (an `https://` URL or a site path), or undefined. */
  value?: string
  /** Only ever called with `undefined`: the one thing that can be done today is to remove the stored image. */
  onChange: (value: string | undefined) => void
  /** Field label and preview alt noun; defaults to the cover-image wording. */
  label?: string
  /** Show the whole picture (e.g. a menu) instead of cropping it to a cover-style 16:9 frame. */
  contain?: boolean
}

/** The one honest sentence: media storage is not built (Phase 13), so no picture can be added yet. */
export const IMAGE_UPLOAD_NOTICE = "Image upload isn't available yet. It is planned for a later release."

/**
 * Optional listing image (Phase 12S, S4: made honest). Real media storage does not exist until Phase 13 and the
 * API accepts only an `https://` URL or a site path (`API_CONTRACT §10.1`), so a picture picked in the browser
 * could never be saved. The old picker showed such a picture as if it were part of the listing and then
 * silently dropped it on submit (and, on an edit, sent `image: null`, which CLEARED the stored image).
 *
 * Now nothing can be picked: the choose button is present but disabled, with the reason written next to it, and
 * an image that is already on file is shown and kept unless the owner removes it. No `blob:` URL is ever made.
 */
function ListingImageInput({ id, value, onChange, label = "Listing Image", contain = false }: ListingImageInputProps) {
  const noticeId = `${id}-notice`

  return (
    <Stack gap={2}>
      <Typography variant="label" id={`${id}-label`}>
        {label}
      </Typography>

      {value && (
        <img
          src={value}
          alt={`Current ${label.toLowerCase()}`}
          className={
            contain
              ? "max-h-64 w-full rounded-lg bg-muted object-contain"
              : "aspect-video w-full rounded-lg object-cover"
          }
        />
      )}

      <Stack direction="row" gap={2}>
        <Button type="button" variant="outline" size="sm" className="w-fit" disabled aria-describedby={noticeId}>
          <ImagePlus />
          Choose Image
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" aria-describedby={`${id}-label`} onClick={() => onChange(undefined)}>
            <X />
            Remove
          </Button>
        )}
      </Stack>

      <Typography id={noticeId} variant="caption" className="text-muted-foreground">
        {IMAGE_UPLOAD_NOTICE}
        {value ? " The image on file is kept unless you remove it." : " This listing will be submitted without an image."}
      </Typography>
    </Stack>
  )
}

export { ListingImageInput }

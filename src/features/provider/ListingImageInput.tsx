import { Image as ImageIcon, ImagePlus, Info, X } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
 * Optional listing image (Phase 12S, S4: made honest; VR5 presentation). Real media storage does not exist until
 * Phase 13 and the API accepts only an `https://` URL or a site path (`API_CONTRACT §10.1`), so a picture picked
 * in the browser could never be saved. The old picker showed such a picture as if it were part of the listing and
 * then silently dropped it on submit (and, on an edit, sent `image: null`, which CLEARED the stored image).
 *
 * Now nothing can be picked: the choose button is present but disabled, with the reason written in a tonal
 * info-ribbon next to it, and an image that is already on file is shown and kept unless the owner removes it. No
 * `blob:` URL is ever made.
 */
function ListingImageInput({ id, value, onChange, label = "Listing Image", contain = false }: ListingImageInputProps) {
  const noticeId = `${id}-notice`

  return (
    <Stack gap={3}>
      <Typography variant="label" id={`${id}-label`}>
        {label}
      </Typography>

      {value ? (
        <img
          src={value}
          alt={`Current ${label.toLowerCase()}`}
          className={
            contain
              ? "max-h-64 w-full rounded-xl bg-muted object-contain ring-1 ring-border"
              : "aspect-video w-full rounded-xl object-cover ring-1 ring-border"
          }
        />
      ) : (
        <div
          role="img"
          aria-label={`No ${label.toLowerCase()} on file`}
          className={cn(
            "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl ring-1 ring-border",
            "bg-gradient-to-br from-secondary via-secondary/80 to-accent/70 text-muted-foreground"
          )}
        >
          <span aria-hidden="true" className="grid-lines absolute inset-0 opacity-50" />
          <div className="relative flex flex-col items-center gap-2.5 px-6 text-center">
            <span className="glass-2 flex size-12 items-center justify-center rounded-2xl">
              <ImageIcon className="size-5" aria-hidden="true" />
            </span>
            <Typography as="span" variant="caption" className="font-medium text-foreground">
              No photo on file
            </Typography>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 rounded-xl bg-info/10 px-3.5 py-2.5 ring-1 ring-info/25">
        <Info className="mt-0.5 size-4 shrink-0 text-info-text" aria-hidden="true" />
        <Typography id={noticeId} as="p" variant="body-sm" className="min-w-0 flex-1 text-foreground">
          {IMAGE_UPLOAD_NOTICE}
          {value ? " The image on file is kept unless you remove it." : " This listing will be submitted without an image."}
        </Typography>
      </div>

      <Stack direction="row" gap={2} className="flex-wrap">
        <Button type="button" variant="outline" size="sm" className="h-10" disabled aria-describedby={noticeId}>
          <ImagePlus />
          Choose Image
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10"
            aria-describedby={`${id}-label`}
            onClick={() => onChange(undefined)}
          >
            <X />
            Remove
          </Button>
        )}
      </Stack>
    </Stack>
  )
}

export { ListingImageInput }

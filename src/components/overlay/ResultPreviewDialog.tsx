import { MapPin } from "lucide-react"
import { useNavigate } from "react-router-dom"
import type { SearchResult } from "@/types/search"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { CardImage } from "@/components/media/CardImage"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import {
  providerProfilePath,
  businessProfilePath,
  newsArticlePath,
  tutorProfilePath,
  propertyDetailsPath,
} from "@/config/routes"

interface ResultPreviewDialogProps {
  result: SearchResult | null
  onOpenChange: (open: boolean) => void
}

/**
 * Lightweight preview for the Home / Search discovery journey. Its one action opens the real detail
 * page of the result; there is no contact action here because no contact feature exists (a service
 * request is made from the Provider's own page).
 */
function ResultPreviewDialog({ result, onOpenChange }: ResultPreviewDialogProps) {
  const navigate = useNavigate()

  function handlePrimaryAction() {
    if (!result) return
    onOpenChange(false)
    switch (result.kind) {
      case "provider":
        navigate(providerProfilePath(result.id))
        return
      case "business":
        navigate(businessProfilePath(result.id))
        return
      case "tutor":
        navigate(tutorProfilePath(result.id))
        return
      case "property":
        navigate(propertyDetailsPath(result.id))
        return
      case "news":
        navigate(newsArticlePath(result.id))
        return
    }
  }

  const primaryLabel = result ? (result.kind === "news" ? "Read More" : result.kind === "property" ? "View Details" : "View Profile") : ""

  return (
    <Dialog open={!!result} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {result && (
          <>
            <CardImage src={result.image} icon={result.icon} label={result.title} className="-mt-2" decorative />
            <DialogHeader>
              <Stack direction="row" justify="between" align="start" gap={2}>
                <DialogTitle>{result.title}</DialogTitle>
              </Stack>
              <DialogDescription>{result.subtitle}</DialogDescription>
            </DialogHeader>

            <Stack gap={2} className="text-left">
              <Typography variant="body-sm" className="text-muted-foreground">
                {result.description}
              </Typography>
              {result.area && (
                <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                  <Typography variant="caption">{result.area}</Typography>
                </Stack>
              )}
              <Stack direction="row" wrap gap={2}>
                {result.tags.slice(0, 4).map((tag) => (
                  <Badge key={tag} variant="outline" className="font-normal">
                    {tag}
                  </Badge>
                ))}
              </Stack>
            </Stack>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button className="flex-1" onClick={handlePrimaryAction}>
                {primaryLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { ResultPreviewDialog }

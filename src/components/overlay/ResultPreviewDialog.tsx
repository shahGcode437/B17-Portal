import { MapPin, MessageCircle } from "lucide-react"
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
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { providerProfilePath } from "@/config/routes"

interface ResultPreviewDialogProps {
  result: SearchResult | null
  onOpenChange: (open: boolean) => void
}

/**
 * Lightweight "Provider/Business Preview" for the Home/Search discovery
 * journey. Provider results now route through to the real Provider Profile
 * (Phase 3A); other kinds keep this dialog until their own profile pages exist.
 */
function ResultPreviewDialog({ result, onOpenChange }: ResultPreviewDialogProps) {
  const { show } = useToast()
  const navigate = useNavigate()

  function handlePrimaryAction() {
    if (!result) return
    if (result.kind === "provider") {
      onOpenChange(false)
      navigate(providerProfilePath(result.id))
      return
    }
    show(SIMULATED_MESSAGES.contact)
  }

  const primaryLabel = result
    ? result.kind === "provider"
      ? "View Profile"
      : result.kind === "property"
        ? "Contact Agent"
        : result.kind === "news"
          ? "Read More"
          : "Request / Contact"
    : ""

  return (
    <Dialog open={!!result} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {result && (
          <>
            <CardImage src={result.image} icon={result.icon} label={result.title} className="-mt-2" />
            <DialogHeader>
              <Stack direction="row" justify="between" align="start" gap={2}>
                <DialogTitle>{result.title}</DialogTitle>
                <DemoBadge />
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
              {result.kind !== "provider" && (
                <Typography variant="caption" className="text-muted-foreground">
                  A full profile page is available in a later phase of the prototype.
                </Typography>
              )}
            </Stack>

            <DialogFooter className="gap-2 sm:gap-2">
              {result.kind !== "news" && (
                <Button variant="outline" className="flex-1" onClick={() => show(SIMULATED_MESSAGES.whatsapp)}>
                  <MessageCircle />
                  WhatsApp
                </Button>
              )}
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

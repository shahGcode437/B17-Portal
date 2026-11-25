import { MessageCircle, Phone } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatPhone, telHref, whatsappHref } from "@/lib/phone"

/** Just the two public contact numbers of a listing — every kind that has them looks the same here. */
interface ListingContact {
  contactPhone?: string
  whatsappPhone?: string
}

interface ContactActionsProps extends ListingContact {
  /** The listing's name, so each link says what it reaches. */
  name: string
}

/**
 * Whether a listing has any usable contact action (Listing Contact v1). A legacy listing has none, and a
 * stored value that is not canonical would produce no link, so the page keeps its honest
 * "no contact path yet" note instead of rendering a dead button.
 */
function hasContactActions(listing: ListingContact): boolean {
  return telHref(listing.contactPhone) !== null || whatsappHref(listing.whatsappPhone) !== null
}

/**
 * "Call" and (when the owner gave a WhatsApp number) "WhatsApp" for one listing — the real contact
 * actions of Contact Model v1, placed in `DetailActionRegion`'s `action` slot.
 *
 * Both hrefs come from `@/lib/phone`, which builds a link ONLY from a canonical E.164 value and
 * returns `null` for anything else, so no raw or malformed input can ever reach a `tel:` or
 * `wa.me` URL. The number is shown in the Call label in its familiar national form, so a person can
 * read it (or dial it by hand) without tapping.
 */
function ContactActions({ name, contactPhone, whatsappPhone }: ContactActionsProps) {
  const tel = telHref(contactPhone)
  const whatsapp = whatsappHref(whatsappPhone)
  if (!tel && !whatsapp) return null

  return (
    <>
      {tel && contactPhone && (
        <a href={tel} className={cn(buttonVariants({ size: "lg" }))}>
          <Phone aria-hidden="true" />
          Call {formatPhone(contactPhone)}
          <span className="sr-only"> ({name})</span>
        </a>
      )}
      {whatsapp && whatsappPhone && (
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
        >
          <MessageCircle aria-hidden="true" />
          WhatsApp
          <span className="sr-only">
            {" "}
            {formatPhone(whatsappPhone)} ({name}) — opens WhatsApp in a new tab
          </span>
        </a>
      )}
    </>
  )
}

export { ContactActions, hasContactActions }

import type { UseFormRegisterReturn } from "react-hook-form"
import { Phone } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { FieldError } from "@/components/forms/FieldError"
import { FormSection } from "@/components/forms/FormSection"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MAX_PHONE_LENGTH, PHONE_EXAMPLE } from "@/lib/phone"

interface ContactFieldsProps {
  contactProps: UseFormRegisterReturn
  whatsappProps: UseFormRegisterReturn
  contactError?: string
  whatsappError?: string
}

/**
 * The listing's public contact numbers (Listing Contact v1) — one section shared by every owner listing form
 * (Business / Food, Tutor, Property), so the two fields are asked for, labelled and validated
 * identically everywhere.
 *
 * It asks for THIS LISTING's numbers, which is why the helper text says so: the portal holds no
 * account phone number and never fills one in here. The contact number is required (a listing a
 * customer cannot reach is not a useful listing); WhatsApp is optional and, when given, is the only
 * thing that puts a WhatsApp button on the public page.
 *
 * `type="tel"` + `inputMode="tel"` so a phone shows the dialling keypad, and `autoComplete="off"`:
 * the browser's saved personal number is exactly what this field is NOT asking for.
 */
function ContactFields({ contactProps, whatsappProps, contactError, whatsappError }: ContactFieldsProps) {
  return (
    <FormSection
      icon={Phone}
      title="Contact details"
      description="How customers reach this listing. Publicly visible on its detail page."
    >
      <Stack gap={2}>
        <Label htmlFor="listing-contact-phone">Contact Number</Label>
        <Input
          id="listing-contact-phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={MAX_PHONE_LENGTH}
          placeholder={`e.g. ${PHONE_EXAMPLE}`}
          aria-invalid={!!contactError}
          aria-describedby={[contactError ? "listing-contact-phone-error" : null, "listing-contact-phone-hint"].filter(Boolean).join(" ")}
          {...contactProps}
        />
        <FieldError id="listing-contact-phone-error" message={contactError} />
        <Typography id="listing-contact-phone-hint" variant="caption" className="text-muted-foreground">
          The number for THIS listing, not your personal account — publicly visible on the detail page ({PHONE_EXAMPLE} or +92{PHONE_EXAMPLE.slice(1)}).
        </Typography>
      </Stack>

      <Stack gap={2}>
        <Label htmlFor="listing-whatsapp-phone">WhatsApp Number (optional)</Label>
        <Input
          id="listing-whatsapp-phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={MAX_PHONE_LENGTH}
          placeholder={`e.g. ${PHONE_EXAMPLE}`}
          aria-invalid={!!whatsappError}
          aria-describedby={[whatsappError ? "listing-whatsapp-phone-error" : null, "listing-whatsapp-phone-hint"].filter(Boolean).join(" ")}
          {...whatsappProps}
        />
        <FieldError id="listing-whatsapp-phone-error" message={whatsappError} />
        <Typography id="listing-whatsapp-phone-hint" variant="caption" className="text-muted-foreground">
          Leave this empty if you do not use WhatsApp; a WhatsApp button is shown only when you add one.
        </Typography>
      </Stack>
    </FormSection>
  )
}

export { ContactFields }

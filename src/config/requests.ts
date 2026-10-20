import type { ContactChannel } from "@/types/resident"

/**
 * How a requester would LIKE to be reached (Phase 12F, the V1 contact model in DECISIONS.md). It is a
 * preference stored on the request - nothing is sent and no number is stored - so the wording says
 * "prefers", never "will be contacted by".
 */
export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  in_app: "in B-17 Portal",
  whatsapp: "on WhatsApp",
  phone: "by phone",
}

export function contactPreferenceLabel(channel: ContactChannel | undefined): string | null {
  return channel ? `Prefers to be reached ${CONTACT_CHANNEL_LABELS[channel]}` : null
}

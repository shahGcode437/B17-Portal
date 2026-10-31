import type { ContactChannel } from "@/types/resident"

/**
 * How a requester would LIKE to be reached (Phase 12F, the V1 contact model in DECISIONS.md). It is a
 * preference stored on the request - nothing is sent and no number is stored - so the wording says
 * "prefers", never "will be contacted by". Since S5A the request form only ever stores `in_app`; WhatsApp and phone
 * remain here so a request that was stored with one of them (the API still accepts all three) is shown truthfully.
 */
export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  in_app: "in B-17 Portal",
  whatsapp: "on WhatsApp",
  phone: "by phone",
}

/** Only a preference that says something: `in_app` is the one route every request has, so it needs no line of its own. */
export function contactPreferenceLabel(channel: ContactChannel | undefined): string | null {
  return channel && channel !== "in_app" ? `Prefers to be reached ${CONTACT_CHANNEL_LABELS[channel]}` : null
}

import type { SponsoredCard } from "@/types/sponsored"

/**
 * Demo sponsored placements (Prototype Data Contract: 2–3). Illustrates the
 * future advertising module — not a real advertiser or paid offer.
 */
export const sponsoredCards: SponsoredCard[] = [
  {
    id: "sponsored-01",
    title: "Feature Your Business on B-17 Portal",
    description:
      "Sponsored placements will let local businesses reach more B-17 residents. Coming in a future release.",
    image: "/images/ads/construction-demo-ad.jpg",
  },
  {
    id: "sponsored-02",
    title: "Seasonal Home Services Offer",
    description:
      "Example of how a seasonal promotion could appear for a featured home-services provider.",
    image: "/images/ads/solar-demo-ad.webp",
  },
]

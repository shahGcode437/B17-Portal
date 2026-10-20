/**
 * Deterministic API payloads (test helper only - nothing here ships). They have EXACTLY the shapes
 * the backend returns (captured from the real local API in Phase 12G and checked against its
 * OpenAPI document), so unit tests and the Playwright suite exercise the same contract.
 *
 * Framework-agnostic on purpose: no Vitest, no Playwright, no path aliases at runtime (type-only
 * imports are erased), so both test runners can import it.
 *
 * The dataset covers every case the read integration must handle: all five listing kinds, Food as a
 * vertical of Business, and every location mode - exact, approximate, area-only - plus rejected /
 * pending / archived owner listings and requests in several statuses.
 */
import type {
  BusinessDto,
  CategoryDto,
  NewsDto,
  PropertyDto,
  ProviderDto,
  TutorDto,
} from "../../lib/api/dto/public"
import type {
  AdminCategoryDto,
  AdminHistoryEntryDto,
  AdminListingDto,
  AdminListingSummaryDto,
  LeadSummaryDto,
  OwnerListingDto,
  RequestDetailDto,
  RequestSummaryDto,
  SavedHitDto,
} from "../../lib/api/dto/private"

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

export const IDS = {
  provider: uuid(101),
  providerSecond: uuid(102),
  generalExact: uuid(201),
  generalAreaOnly: uuid(202),
  foodExact: uuid(203),
  foodApproximate: uuid(204),
  foodRestaurant: uuid(205),
  tutorApproximate: uuid(301),
  tutorAreaOnly: uuid(302),
  propertyExact: uuid(401),
  propertyAreaOnly: uuid(402),
  news: uuid(501),
  newsUpdate: uuid(502),
  ownerPending: uuid(601),
  ownerApproved: uuid(602),
  ownerRejected: uuid(603),
  ownerArchived: uuid(604),
  requestOne: uuid(701),
  requestTwo: uuid(702),
  requestThree: uuid(703),
  adminPending: uuid(801),
}

/** The one place the fixtures state their private (exact) points, so tests can prove they never leak. */
export const PRIVATE_POINT = { latitude: 33.7099999, longitude: 73.0999999 }
export const PRIVATE_ADDRESS = "House 7, Private Lane 3"

const ref = (slug: string, name: string, isPrimary = true) => ({ slug, name, isPrimary })

// -- categories ---------------------------------------------------------------------------------------

export const CATEGORIES: AdminCategoryDto[] = [
  ["services", "construction", "Construction", 1],
  ["services", "electrical", "Electrical", 2],
  ["services", "solar", "Solar", 3],
  ["directory", "pharmacy", "Pharmacy", 1],
  ["directory", "hairdressing", "Hairdressing", 2],
  ["food", "restaurants", "Restaurants", 1],
  ["food", "cafes", "Cafes", 2],
  ["food", "bakeries", "Bakeries", 3],
  ["food", "sweets-desserts", "Sweets / Desserts", 4],
  ["education", "physics", "Physics", 1],
  ["education", "mathematics", "Mathematics", 2],
  ["property", "house", "House", 1],
  ["property", "flat", "Flat", 2],
  ["news", "community", "Community", 1],
  ["news", "utilities", "Utilities", 2],
].map(([module, slug, name, displayOrder], index) => ({
  id: uuid(900 + index),
  module: module as CategoryDto["module"],
  slug: slug as string,
  name: name as string,
  displayOrder: displayOrder as number,
  isActive: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
}))
// One category an admin has deactivated: the public list must never offer it, the admin list shows it.
CATEGORIES.push({
  id: uuid(990),
  module: "directory",
  slug: "retired-category",
  name: "Retired Category",
  displayOrder: 9,
  isActive: false,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
})

// -- public listings (as the DETAIL returns them; search cards drop address / landmark / menu) --------

export const PROVIDERS: ProviderDto[] = [
  {
    kind: "provider",
    id: IDS.provider,
    name: "Sunrise Solar Solutions",
    category: "solar",
    categoryLabel: "Solar",
    description: "Rooftop solar design and installation for homes in B-17.",
    area: "B-17, Block C (Demo Area)",
    location: { visibility: "area_only" },
    image: "/images/providers/solar-provider.jpg",
    tags: ["solar", "installation"],
    categories: [ref("solar", "Solar")],
    featured: true,
  },
  {
    kind: "provider",
    id: IDS.providerSecond,
    name: "Bright Electric Works",
    category: "electrical",
    categoryLabel: "Electrical",
    description: "Wiring, fault finding and safe electrical repairs.",
    area: "B-17",
    location: { visibility: "area_only", block: "B" },
    tags: ["electrician", "wiring"],
    categories: [ref("electrical", "Electrical")],
  },
]

export const BUSINESSES: BusinessDto[] = [
  {
    kind: "business",
    id: IDS.generalExact,
    name: "Glow Salon",
    vertical: "general",
    category: "Hairdressing",
    description: "Haircuts, styling and grooming for the whole family.",
    area: "B-17",
    location: {
      visibility: "exact",
      block: "D",
      address: "Shop 9, Salon Row",
      landmark: "Next to the bank",
      coordinates: { latitude: 33.70789, longitude: 73.052109, precision: "exact" },
    },
    tags: ["salon", "haircut"],
    categories: [ref("hairdressing", "Hairdressing")],
  },
  {
    kind: "business",
    id: IDS.generalAreaOnly,
    name: "B-17 Family Pharmacy",
    vertical: "general",
    category: "Pharmacy",
    description: "General pharmacy and healthcare essentials.",
    area: "B-17, Block C (Demo Area)",
    location: { visibility: "area_only" },
    tags: ["pharmacy", "medicine"],
    categories: [ref("pharmacy", "Pharmacy")],
    featured: true,
  },
  {
    kind: "business",
    id: IDS.foodExact,
    name: "Capital Bakers",
    vertical: "food",
    category: "Bakeries",
    description: "Fresh bread, cakes and daily bakery items.",
    area: "B-17",
    location: {
      visibility: "exact",
      block: "C",
      address: "Shop 4, Demo Plaza",
      landmark: "Next to the demo park",
      coordinates: { latitude: 33.701234, longitude: 73.051234, precision: "exact" },
    },
    tags: ["bakery", "cakes"],
    categories: [ref("bakeries", "Bakeries"), ref("sweets-desserts", "Sweets / Desserts", false)],
    food: {
      categories: ["bakeries", "sweets-desserts"],
      serviceOptions: ["takeaway", "delivery"],
      hoursNote: "Daily, 8 AM-10 PM",
      menuHighlights: [
        { id: uuid(1001), name: "Fresh Milk Bread", section: "Bakery", price: "PKR 250" },
        { id: uuid(1002), name: "Chocolate Fudge Cake", section: "Cakes", description: "Made fresh daily.", price: "PKR 1,800" },
      ],
    },
  },
  {
    kind: "business",
    id: IDS.foodApproximate,
    name: "Mocha Corner Cafe",
    vertical: "food",
    category: "Cafes",
    description: "Specialty coffee, cold brew and light bites.",
    area: "B-17",
    location: {
      visibility: "approximate",
      block: "C",
      coordinates: { latitude: 33.71, longitude: 73.06, precision: "approximate" },
    },
    tags: ["coffee", "cafe"],
    categories: [ref("cafes", "Cafes")],
    food: { categories: ["cafes"], serviceOptions: ["dine-in", "takeaway"] },
  },
  {
    kind: "business",
    id: IDS.foodRestaurant,
    name: "Karahi Junction",
    vertical: "food",
    category: "Restaurants",
    description: "Desi food, karahi and grill, dine-in and takeaway.",
    area: "B-17, Block A",
    location: { visibility: "area_only", block: "A" },
    tags: ["karahi", "desi food"],
    categories: [ref("restaurants", "Restaurants")],
    food: { categories: ["restaurants"], serviceOptions: ["dine-in", "takeaway", "delivery"] },
  },
]

export const TUTORS: TutorDto[] = [
  {
    kind: "tutor",
    id: IDS.tutorApproximate,
    name: "Sara M.",
    subject: "Physics",
    grade: "Grade 9",
    bio: "Physics tutor focused on O/A-level and matric board preparation.",
    area: "B-17",
    location: {
      visibility: "approximate",
      block: "C",
      coordinates: { latitude: 33.7, longitude: 73.06, precision: "approximate" },
    },
    tags: ["physics", "tutor"],
    categories: [ref("physics", "Physics")],
  },
  {
    kind: "tutor",
    id: IDS.tutorAreaOnly,
    name: "Ali R.",
    subject: "Mathematics",
    grade: "Grade 10",
    bio: "Mathematics tutor for matric and O-level students.",
    area: "B-17",
    location: { visibility: "area_only", block: "D" },
    tags: ["mathematics", "tutor"],
    categories: [ref("mathematics", "Mathematics")],
  },
]

export const PROPERTIES: PropertyDto[] = [
  {
    kind: "property",
    id: IDS.propertyExact,
    title: "5 Marla House - B-17 Block C",
    listingType: "sale",
    propertyType: "House",
    price: "PKR 2.2 Cr",
    description: "A family house in B-17 Block C.",
    bedrooms: 3,
    furnished: "Unfurnished",
    area: "B-17",
    location: {
      visibility: "exact",
      block: "C",
      address: "Plot 12, Street 4",
      landmark: "Near the park",
      coordinates: { latitude: 33.703456, longitude: 73.054321, precision: "exact" },
    },
    tags: ["house", "sale"],
    categories: [ref("house", "House")],
  },
  {
    kind: "property",
    id: IDS.propertyAreaOnly,
    title: "2 Bed Flat for Rent - B-17 Block D",
    listingType: "rent",
    propertyType: "Flat",
    price: "PKR 55,000 / month",
    description: "A bright, furnished flat close to the main market.",
    bedrooms: 2,
    furnished: "Furnished",
    area: "B-17, Block D (Demo Area)",
    location: { visibility: "area_only" },
    tags: ["flat", "rent"],
    categories: [ref("flat", "Flat")],
  },
]

export const NEWS: NewsDto[] = [
  {
    id: IDS.news,
    kind: "news",
    status: "published",
    title: "B-17 Community Park Cleanup Drive This Weekend",
    category: "Community",
    categorySlug: "community",
    summary: "Residents are invited to join a local cleanup drive at the B-17 community park.",
    image: "/images/news/community-cleanup.jpg",
    publishedAt: "2026-09-05",
    tags: ["community", "cleanup"],
  },
  {
    id: IDS.newsUpdate,
    kind: "update",
    status: "published",
    title: "Water Supply Schedule Update for Block D",
    category: "Utilities",
    categorySlug: "utilities",
    summary: "Water will be supplied from 6 AM to 9 AM daily while pipe work continues.",
    publishedAt: "2026-09-12",
    tags: ["water", "schedule"],
  },
]

// -- the signed-in resident's data --------------------------------------------------------------------

export const SAVED: SavedHitDto[] = [
  { kind: "provider", item: PROVIDERS[0], savedAt: "2026-10-10T09:00:00Z" },
  { kind: "business", item: BUSINESSES[2], savedAt: "2026-10-09T09:00:00Z" },
]

const base = (id: string, over: Partial<RequestSummaryDto>): RequestSummaryDto => ({
  id,
  providerListingId: IDS.provider,
  providerName: "Sunrise Solar Solutions",
  service: "Solar installation",
  details: "I would like a quote for a 5 kW rooftop system.",
  area: "B-17, Block C",
  preferredDate: "2026-10-25",
  preferredContactChannel: "whatsapp",
  status: "submitted",
  createdAt: "2026-10-12T10:00:00Z",
  updatedAt: "2026-10-12T10:00:00Z",
  ...over,
})

export const MY_REQUESTS: RequestSummaryDto[] = [
  base(IDS.requestOne, { preferredTime: "10:30", notes: "Please call first." }),
  base(IDS.requestTwo, { status: "completed", service: "Panel inspection", createdAt: "2026-10-01T10:00:00Z" }),
  base(IDS.requestThree, {
    status: "cancelled",
    providerListingId: undefined,
    providerName: "A provider that has since been removed",
    preferredContactChannel: "phone",
    createdAt: "2026-09-20T10:00:00Z",
  }),
]

export const LEADS: LeadSummaryDto[] = [
  { ...base(IDS.requestOne, {}), requesterName: "Rana Resident" },
  { ...base(IDS.requestTwo, { status: "in-progress", service: "Wiring check" }), requesterName: "Naila Khan" },
]

export const REQUEST_HISTORY: Record<string, RequestDetailDto["history"]> = {
  [IDS.requestOne]: [{ toStatus: "submitted", actorRole: "requester", createdAt: "2026-10-12T10:00:00Z" }],
  [IDS.requestTwo]: [
    { toStatus: "submitted", actorRole: "requester", createdAt: "2026-10-01T10:00:00Z" },
    { fromStatus: "submitted", toStatus: "accepted", actorRole: "provider", createdAt: "2026-10-02T10:00:00Z" },
    { fromStatus: "accepted", toStatus: "in-progress", actorRole: "provider", createdAt: "2026-10-03T10:00:00Z" },
  ],
}

// -- the signed-in owner's listings (PRIVATE location included) ------------------------------------------

const ownerBase = {
  area: "B-17",
  tags: ["demo"],
  submittedAt: "2026-10-05T08:00:00Z",
  createdAt: "2026-10-05T08:00:00Z",
  updatedAt: "2026-10-06T08:00:00Z",
}

export const OWNER_LISTINGS: OwnerListingDto[] = [
  {
    ...ownerBase,
    kind: "business",
    vertical: "general",
    id: IDS.ownerPending,
    status: "pending",
    revision: 2,
    name: "Pending Stationers",
    category: "Stationery",
    categoryLabel: "Stationery",
    description: "A stationery shop waiting for review.",
    location: { visibility: "exact", block: "B", address: PRIVATE_ADDRESS, ...PRIVATE_POINT },
    publicLocation: { visibility: "exact", block: "B", coordinates: { ...PRIVATE_POINT, precision: "exact" } },
    categories: [ref("stationery", "Stationery")],
  },
  {
    ...ownerBase,
    kind: "provider",
    id: IDS.ownerApproved,
    status: "approved",
    revision: 3,
    name: "Approved Plumbing Co",
    category: "plumbing",
    categoryLabel: "Plumbing",
    description: "Plumbing repairs.",
    location: { visibility: "area_only", block: "A" },
    publicLocation: { visibility: "area_only", block: "A" },
    categories: [ref("plumbing", "Plumbing")],
  },
  {
    ...ownerBase,
    kind: "property",
    id: IDS.ownerRejected,
    status: "rejected",
    revision: 1,
    title: "Rejected Plot",
    listingType: "sale",
    propertyType: "Plot",
    price: "PKR 1 Cr",
    categoryLabel: "Plot",
    rejectionReason: "Please add the plot size and a clearer description.",
    location: { visibility: "approximate", block: "C", address: PRIVATE_ADDRESS, ...PRIVATE_POINT },
    publicLocation: { visibility: "approximate", block: "C", coordinates: { latitude: 33.71, longitude: 73.1, precision: "approximate" } },
    categories: [ref("plot", "Plot")],
  },
  {
    ...ownerBase,
    kind: "tutor",
    id: IDS.ownerArchived,
    status: "archived",
    revision: 4,
    name: "Archived Tutor",
    category: "english",
    categoryLabel: "English",
    grade: "Grade 8",
    location: { visibility: "area_only" },
    publicLocation: { visibility: "area_only" },
    categories: [ref("english", "English")],
  },
]

// -- the admin's view --------------------------------------------------------------------------------------

const history = (reasonForRejection?: string): AdminHistoryEntryDto[] => [
  {
    action: "submitted",
    toStatus: "pending",
    revision: 1,
    actor: { displayName: "Sana Owner", role: "owner" },
    createdAt: "2026-10-05T08:00:00Z",
  },
  ...(reasonForRejection
    ? [
        {
          action: "rejected" as const,
          fromStatus: "pending" as const,
          toStatus: "rejected" as const,
          revision: 1,
          reason: reasonForRejection,
          actor: { displayName: "Site Admin", role: "admin" as const },
          createdAt: "2026-10-06T08:00:00Z",
        },
      ]
    : []),
]

export const ADMIN_LISTINGS: AdminListingDto[] = [
  { ...OWNER_LISTINGS[0], submitter: { displayName: "Sana Owner" }, history: history() } as AdminListingDto,
  {
    ...OWNER_LISTINGS[2],
    submitter: { displayName: "Sana Owner" },
    history: history("Please add the plot size and a clearer description."),
  } as AdminListingDto,
  { ...OWNER_LISTINGS[1], submitter: { displayName: "Faisal Provider" }, history: history() } as AdminListingDto,
]

/** The queue rows (`GET /admin/listings`): a summary with the visibility mode only - never the location itself. */
export const ADMIN_QUEUE: AdminListingSummaryDto[] = ADMIN_LISTINGS.map((listing) => ({
  id: listing.id,
  kind: listing.kind,
  ...(listing.kind === "business" ? { vertical: listing.vertical } : {}),
  title: listing.kind === "property" ? listing.title : listing.name,
  area: listing.area,
  ...(listing.location.block ? { block: listing.location.block } : {}),
  locationVisibility: listing.location.visibility,
  categoryLabel: listing.categoryLabel,
  status: listing.status,
  revision: listing.revision,
  submittedAt: listing.submittedAt,
  updatedAt: listing.updatedAt,
  ...(listing.submitter ? { submitter: listing.submitter } : {}),
}))

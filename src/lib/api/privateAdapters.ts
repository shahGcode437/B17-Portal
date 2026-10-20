import type {
  LeadSummaryDto,
  RequestDetailDto,
  RequestSummaryDto,
  SavedHitDto,
} from "@/lib/api/dto/private"
import { toBusiness, toProperty, toProvider, toTutor } from "@/lib/api/adapters"
import type { SearchHit } from "@/types/search"
import type { RequestHistoryEntry, ServiceRequestRecord } from "@/types/resident"

/**
 * Backend DTO -> UI view model for the signed-in areas (Phase 12G): Saved items and service
 * requests. Ids and the canonical status are preserved; nothing is invented. A requester appears to
 * the provider by display name only, and the requester's own e-mail / ids never reach these models
 * (the API does not send them).
 */

/** A saved listing: the same public card view model as a search hit, plus when it was saved. */
export interface SavedEntry {
  hit: Exclude<SearchHit, { kind: "news" }>
  savedAt: string
}

export function toSavedEntry(dto: SavedHitDto): SavedEntry | null {
  switch (dto.kind) {
    case "provider":
      return { hit: { kind: "provider", item: toProvider(dto.item) }, savedAt: dto.savedAt }
    case "business":
      return { hit: { kind: "business", item: toBusiness(dto.item) }, savedAt: dto.savedAt }
    case "tutor":
      return { hit: { kind: "tutor", item: toTutor(dto.item) }, savedAt: dto.savedAt }
    case "property":
      return { hit: { kind: "property", item: toProperty(dto.item) }, savedAt: dto.savedAt }
    default:
      return null // a kind this client does not know is skipped, never rendered half-built
  }
}

function toRecord(
  dto: RequestSummaryDto | LeadSummaryDto,
  requestedBy: string
): ServiceRequestRecord {
  return {
    id: dto.id,
    ...(dto.providerListingId ? { providerId: dto.providerListingId } : {}),
    providerName: dto.providerName,
    service: dto.service,
    details: dto.details,
    area: dto.area,
    preferredDate: dto.preferredDate,
    ...(dto.preferredTime ? { preferredTime: dto.preferredTime } : {}),
    ...(dto.notes ? { notes: dto.notes } : {}),
    preferredContactChannel: dto.preferredContactChannel,
    requestedBy,
    submittedAt: dto.createdAt,
    status: dto.status,
  }
}

/** The requester's own row: `requestedBy` is the signed-in user (the API does not repeat it back). */
export function toMyRequestRecord(dto: RequestSummaryDto, displayName: string): ServiceRequestRecord {
  return toRecord(dto, displayName)
}

/** The provider's inbox row: the requester by display name. */
export function toLeadRecord(dto: LeadSummaryDto): ServiceRequestRecord {
  return toRecord(dto, dto.requesterName)
}

export interface RequestDetailView {
  record: ServiceRequestRecord
  viewerRole: "requester" | "provider"
  history: RequestHistoryEntry[]
}

export function toRequestDetailView(dto: RequestDetailDto): RequestDetailView {
  return {
    record: toRecord(dto, dto.requesterName),
    viewerRole: dto.viewerRole,
    history: dto.history.map((entry) => ({
      ...(entry.fromStatus ? { fromStatus: entry.fromStatus } : {}),
      toStatus: entry.toStatus,
      actorRole: entry.actorRole,
      at: entry.createdAt,
    })),
  }
}

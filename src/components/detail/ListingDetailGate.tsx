import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ReadError } from "@/components/feedback/ReadError"
import { Skeleton } from "@/components/ui/skeleton"
import type { ReadResult } from "@/hooks/useRead"
import type { ListingDetail } from "@/hooks/useListings"

type Kind = "provider" | "business" | "tutor" | "property"

/** A placeholder in the shape of a detail page (cover, identity panel, a few sections) so nothing jumps. */
function DetailSkeleton() {
  return (
    <Container className="py-6 sm:py-10">
      <div role="status" aria-label="Loading" className="mx-auto max-w-3xl lg:max-w-6xl">
        <span className="sr-only">Loading…</span>
        <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl lg:row-span-2" />
          <Stack gap={3}>
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </Stack>
        </div>
      </div>
    </Container>
  )
}

interface NotFoundCopy {
  icon: LucideIcon
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}

interface ListingDetailGateProps<K extends Kind> {
  read: ReadResult<ListingDetail<K>>
  notFound: NotFoundCopy
  children: (item: Extract<ListingDetail<K>, { found: true }>["item"]) => ReactNode
}

/**
 * The state machine every public detail page shares (Phase 12G): a skeleton while the read is in
 * flight, "not found" for a `404` or for a listing of another kind (e.g. a business id opened on a
 * provider page), a retryable error for anything else, and the page content only when a real listing
 * arrived. There is no fallback to demo content: a failed read is shown as a failed read.
 */
function ListingDetailGate<K extends Kind>({ read, notFound, children }: ListingDetailGateProps<K>) {
  const missing = (
    <Container className="py-16">
      <EmptyState
        headingLevel={1}
        icon={notFound.icon}
        title={notFound.title}
        description={notFound.description}
        actionLabel={notFound.actionLabel}
        onAction={notFound.onAction}
      />
    </Container>
  )
  if (read.status === "loading") return <DetailSkeleton />
  if (read.status === "error") {
    if (read.error.status === 404) return missing
    return (
      <Container className="py-16">
        <ReadError error={read.error} onRetry={read.retry} headingLevel={1} />
      </Container>
    )
  }
  if (!read.data.found) return missing
  return <>{children(read.data.item)}</>
}

export { ListingDetailGate, DetailSkeleton }

import { Skeleton } from "@/components/ui/skeleton"
import { Stack } from "@/components/foundation/Stack"

/** Loading placeholder matching the shape of a result/domain card. */
function ResultCardSkeleton() {
  return (
    <Stack
      gap={3}
      className="overflow-hidden rounded-xl border border-border bg-card p-3 shadow-subtle"
      aria-hidden="true"
    >
      <Skeleton className="aspect-video w-full rounded-lg" />
      <Stack gap={2} className="px-1 pb-1">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-full" />
      </Stack>
    </Stack>
  )
}

export { ResultCardSkeleton }

import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"
import { Stack } from "@/components/foundation/Stack"

/** Loading placeholder matching the shape of a result/domain card — shares the same surface as the cards it stands in for. */
function ResultCardSkeleton() {
  return (
    <Card variant="default" className="overflow-hidden" aria-hidden="true">
      <Skeleton className="aspect-video w-full rounded-lg" />
      <Stack gap={2} className="px-1 pb-1">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-full" />
      </Stack>
    </Card>
  )
}

export { ResultCardSkeleton }

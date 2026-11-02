import { Badge } from "@/components/ui/badge"

interface DetailTagListProps {
  tags: string[]
}

/** The item's real tags as soft chips; renders nothing for an empty list (so no empty section needs to be guarded by callers beyond omitting the section). */
function DetailTagList({ tags }: DetailTagListProps) {
  if (tags.length === 0) return null

  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li key={tag}>
          <Badge
            variant="secondary"
            className="h-auto min-h-7 whitespace-normal rounded-full px-3 py-1 text-sm font-medium capitalize"
          >
            {tag}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

export { DetailTagList }

import { Badge } from "@/components/ui/badge"

interface DetailTagListProps {
  tags: string[]
}

/** The item's real tags as outline chips; renders nothing for an empty list (so no empty section needs to be guarded by callers beyond omitting the section). */
function DetailTagList({ tags }: DetailTagListProps) {
  if (tags.length === 0) return null

  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li key={tag}>
          <Badge variant="outline" className="h-auto min-h-6 whitespace-normal py-1 font-normal capitalize">
            {tag}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

export { DetailTagList }

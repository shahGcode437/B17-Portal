import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { PlusCircle, Pencil, Newspaper } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CardImage } from "@/components/media/CardImage"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ContentStatusBadge } from "@/features/admin/ContentStatusBadge"
import { useNewsStore } from "@/state/newsStore"
import { useToast } from "@/hooks/useToast"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { routes, adminContentEditPath } from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
import type { NewsStatus } from "@/types/news"

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

const filterOptions: { value: NewsStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Draft" },
]

/**
 * Content Management (Phase 5B) — Admin-authored News & Daily Updates.
 * No moderation queue, no approve/reject: Admin creates, edits and
 * publishes/unpublishes directly (see ContentStatusBadge for the
 * intentionally separate Draft/Published lifecycle).
 */
function ContentListPage() {
  const admin = useRequireAdminAuth()
  const { items, setStatus } = useNewsStore()
  const { show } = useToast()
  const [filter, setFilter] = useState<NewsStatus | "all">("all")

  const visible = useMemo(
    () =>
      items
        .filter((item) => filter === "all" || item.status === filter)
        .slice()
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    [items, filter]
  )

  if (!admin) return null

  function handleToggleStatus(id: string, current: NewsStatus, title: string) {
    const next: NewsStatus = current === "published" ? "draft" : "published"
    setStatus(id, next)
    show(next === "published" ? `${title} published` : `${title} unpublished`)
  }

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp}>
        <Stack gap={6}>
          <Stack direction="row" align="start" justify="between" gap={3} wrap>
            <Stack gap={1}>
              <Typography variant="h1">News & Updates</Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                Create and manage B-17 news and daily updates.
              </Typography>
            </Stack>
            <Button asChild size="lg">
              <Link to={routes.adminContentNew}>
                <PlusCircle />
                Create Content
              </Link>
            </Button>
          </Stack>

          <ToggleGroup
            type="single"
            variant="outline"
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value as NewsStatus | "all")
            }}
            aria-label="Filter by status"
            className="flex-wrap"
          >
            {filterOptions.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {visible.length === 0 ? (
            <EmptyState
              icon={Newspaper}
              title="No content here"
              description="There is no content matching this filter yet."
            />
          ) : (
            <motion.div initial="initial" animate="animate" variants={staggerContainer}>
              <Stack gap={3}>
                {visible.map((item) => (
                  <motion.div
                    key={item.id}
                    variants={staggerItem}
                    className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-subtle sm:flex-row sm:items-center sm:justify-between"
                  >
                    <Stack direction="row" align="start" gap={3}>
                      <div className="w-20 shrink-0">
                        <CardImage src={item.image} icon={Newspaper} label={item.title} tone="accent" />
                      </div>
                      <Stack gap={1}>
                        <Stack direction="row" align="center" wrap gap={2}>
                          <Typography variant="label">{item.title}</Typography>
                          <Badge variant={item.kind === "update" ? "secondary" : "default"}>
                            {item.kind === "update" ? "Update" : "News"}
                          </Badge>
                        </Stack>
                        <Typography variant="body-sm" className="text-muted-foreground">
                          {item.category}
                        </Typography>
                        <Typography variant="caption" className="text-muted-foreground">
                          {dateFormatter.format(new Date(item.publishedAt))}
                        </Typography>
                      </Stack>
                    </Stack>
                    <Stack
                      direction="row"
                      align="center"
                      justify="between"
                      gap={3}
                      className="sm:flex-col sm:items-end sm:justify-normal"
                    >
                      <ContentStatusBadge status={item.status} />
                      <Stack direction="row" gap={2}>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleToggleStatus(item.id, item.status, item.title)}
                        >
                          {item.status === "published" ? "Unpublish" : "Publish"}
                        </Button>
                        <Button asChild size="sm">
                          <Link to={adminContentEditPath(item.id)}>
                            <Pencil />
                            Edit
                          </Link>
                        </Button>
                      </Stack>
                    </Stack>
                  </motion.div>
                ))}
              </Stack>
            </motion.div>
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ContentListPage }

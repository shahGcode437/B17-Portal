import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { PlusCircle, Pencil, Newspaper } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { WorkspaceEmpty } from "@/components/workspace/WorkspaceEmpty"
import { ContentStatusBadge } from "@/features/admin/ContentStatusBadge"
import { AdminRow, AdminThumb } from "@/features/admin/AdminRow"
import { segmentItemClass, rowActionClass } from "@/features/admin/adminStyles"
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

  const counts = useMemo(() => {
    const byStatus: Record<NewsStatus | "all", number> = { all: items.length, published: 0, draft: 0 }
    for (const item of items) byStatus[item.status] += 1
    return byStatus
  }, [items])

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
            <Button asChild className="h-11 sm:h-9">
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
              <ToggleGroupItem key={option.value} value={option.value} className={segmentItemClass}>
                {option.label} ({counts[option.value]})
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {visible.length === 0 ? (
            <WorkspaceEmpty
              icon={Newspaper}
              message={
                filter === "all" ? "No news or updates have been created yet." : `No ${filter} content.`
              }
              action={
                filter === "all"
                  ? { label: "Create Content", to: routes.adminContentNew }
                  : { label: "Show all content", onClick: () => setFilter("all") }
              }
            />
          ) : (
            <motion.div initial="initial" animate="animate" variants={staggerContainer}>
              <Stack gap={2}>
                {visible.map((item) => (
                  <motion.div key={item.id} variants={staggerItem}>
                    <AdminRow
                      leading={<AdminThumb src={item.image} icon={Newspaper} label={item.title} />}
                      status={<ContentStatusBadge status={item.status} />}
                      actions={
                        <>
                          <Button
                            variant={item.status === "published" ? "outline" : "default"}
                            className={rowActionClass}
                            aria-label={`${item.status === "published" ? "Unpublish" : "Publish"} ${item.title}`}
                            onClick={() => handleToggleStatus(item.id, item.status, item.title)}
                          >
                            {item.status === "published" ? "Unpublish" : "Publish"}
                          </Button>
                          <Button asChild variant="outline" className={rowActionClass}>
                            <Link to={adminContentEditPath(item.id)} aria-label={`Edit ${item.title}`}>
                              <Pencil />
                              Edit
                            </Link>
                          </Button>
                        </>
                      }
                    >
                      <Stack direction="row" align="center" wrap gap={2}>
                        <Typography as="span" variant="label" className="break-words">
                          {item.title}
                        </Typography>
                        <Badge variant="outline" className="font-normal">
                          {item.kind === "update" ? "Update" : "News"}
                        </Badge>
                      </Stack>
                      <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
                        {item.category}
                      </Typography>
                      <Typography as="span" variant="caption">
                        {dateFormatter.format(new Date(item.publishedAt))}
                      </Typography>
                    </AdminRow>
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

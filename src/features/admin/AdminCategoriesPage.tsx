import { motion } from "motion/react"
import { Tags } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { WorkspaceEmpty } from "@/components/workspace/WorkspaceEmpty"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { useAdminCategories } from "@/hooks/useWorkspaceReads"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { fadeUp } from "@/lib/motion"
import type { AdminCategoryView } from "@/types/ownerListing"

const MODULES: { module: AdminCategoryView["module"]; label: string }[] = [
  { module: "services", label: "Services" },
  { module: "directory", label: "Business Directory" },
  { module: "food", label: "Food & Dining" },
  { module: "education", label: "Education" },
  { module: "property", label: "Property" },
  { module: "news", label: "News" },
]

/**
 * Categories (read-only, Phase 12G): every category from `GET /admin/categories`, INACTIVE ones
 * included and marked, grouped by module and in display order. Adding, renaming, moving, deactivating
 * and re-ordering are connected in Phase 12H; this page offers none of them.
 */
function AdminCategoriesPage() {
  const admin = useRequireAdminAuth()
  const read = useAdminCategories()

  if (!admin) return null

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp}>
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">Categories</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Every category, including inactive ones. Editing categories from here is coming soon.
            </Typography>
          </Stack>

          {read.status === "loading" && (
            <div role="status" aria-label="Loading categories" className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14 rounded-xl" />
              ))}
            </div>
          )}
          {read.status === "error" && <ReadError error={read.error} onRetry={read.retry} title="Couldn't load the categories" />}
          {read.status === "success" &&
            (read.data.length === 0 ? (
              <WorkspaceEmpty icon={Tags} message="There are no categories yet." />
            ) : (
              <Stack gap={8}>
                {MODULES.map(({ module, label }) => {
                  const rows = read.data.filter((category) => category.module === module)
                  if (rows.length === 0) return null
                  return (
                    <WorkspaceSection key={module} title={`${label} (${rows.length})`}>
                      <Stack gap={2}>
                        {rows
                          .slice()
                          .sort((a, b) => a.displayOrder - b.displayOrder)
                          .map((category) => (
                            <Card key={category.id} variant="workspace" className="flex-row items-center justify-between gap-3 p-3">
                              <Stack gap={0} className="min-w-0">
                                <Typography as="span" variant="label" className="break-words">
                                  {category.name}
                                </Typography>
                                <Typography as="span" variant="caption" className="break-words">
                                  {category.slug}
                                </Typography>
                              </Stack>
                              <Badge variant={category.isActive ? "secondary" : "outline"} className="shrink-0 font-normal">
                                {category.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </Card>
                          ))}
                      </Stack>
                    </WorkspaceSection>
                  )
                })}
              </Stack>
            ))}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { AdminCategoriesPage }

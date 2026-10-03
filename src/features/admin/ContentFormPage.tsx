import { useNavigate, useParams } from "react-router-dom"
import { motion } from "motion/react"
import { Newspaper } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ContentForm } from "@/features/admin/ContentForm"
import { parseContentTags, type ContentFormValues } from "@/features/admin/contentSchema"
import { useNewsStore } from "@/state/newsStore"
import { useToast } from "@/hooks/useToast"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"
import type { NewsKind, NewsStatus } from "@/types/news"

/**
 * Create + Edit Content (Phase 5B) — one shared page/form for both News and
 * Daily Updates. Admin authors and publishes directly; there is no
 * moderation queue or approval step for this content type.
 */
function ContentFormPage() {
  const admin = useRequireAdminAuth()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { show } = useToast()
  const { items, createItem, updateItem } = useNewsStore()

  const isEditing = Boolean(id)
  const existing = id ? items.find((item) => item.id === id) : undefined

  if (!admin) return null

  if (isEditing && !existing) {
    return (
      <Container className="py-16">
        <EmptyState
          headingLevel={1}
          icon={Newspaper}
          title="Content not found"
          description="This news item or update doesn't exist or may have been removed."
          actionLabel="Back to Content Management"
          onAction={() => navigate(routes.adminContent)}
        />
      </Container>
    )
  }

  function handleSubmit(values: ContentFormValues & { kind: NewsKind; status: NewsStatus }) {
    const tags = parseContentTags(values.tagsInput)
    const image = values.image.trim() || undefined

    if (existing) {
      updateItem(existing.id, {
        title: values.title,
        category: values.category,
        summary: values.summary,
        publishedAt: values.publishedAt,
        tags,
        image,
        kind: values.kind,
        status: values.status,
      })
      show(`${values.title} updated`)
    } else {
      createItem({
        id: crypto.randomUUID(),
        title: values.title,
        category: values.category,
        summary: values.summary,
        publishedAt: values.publishedAt,
        tags,
        image,
        kind: values.kind,
        status: values.status,
      })
      show(values.status === "published" ? `${values.title} published` : `${values.title} saved as draft`)
    }

    navigate(routes.adminContent)
  }

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-xl">
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">{existing ? "Edit Content" : "Create Content"}</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              {existing
                ? "Update this news item or daily update."
                : "Write a news item or daily update and publish it directly — no review step."}
            </Typography>
          </Stack>

          <ContentForm
            defaultValues={
              existing
                ? {
                    title: existing.title,
                    category: existing.category,
                    summary: existing.summary,
                    tagsInput: existing.tags.join(", "),
                    image: existing.image ?? "",
                    publishedAt: existing.publishedAt,
                  }
                : undefined
            }
            defaultKind={existing?.kind}
            defaultStatus={existing?.status}
            submitLabel={existing ? "Save Changes" : "Save Content"}
            onSubmit={handleSubmit}
            onCancel={() => navigate(routes.adminContent)}
          />
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ContentFormPage }

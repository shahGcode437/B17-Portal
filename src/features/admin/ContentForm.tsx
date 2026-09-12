import { useState } from "react"
import { useForm } from "react-hook-form"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { zodResolver } from "@/lib/zodResolver"
import { contentSchema, type ContentFormValues } from "@/features/admin/contentSchema"
import type { NewsKind, NewsStatus } from "@/types/news"

interface ContentFormProps {
  defaultValues?: Partial<ContentFormValues>
  defaultKind?: NewsKind
  defaultStatus?: NewsStatus
  submitLabel: string
  onSubmit: (values: ContentFormValues & { kind: NewsKind; status: NewsStatus }) => void
  onCancel: () => void
}

/**
 * Shared News/Update create+edit form (Phase 5B). Admin authors and directly
 * publishes — there is no submit-for-review, moderation queue, or
 * approve/reject step here, unlike provider listing onboarding.
 */
function ContentForm({
  defaultValues,
  defaultKind = "news",
  defaultStatus = "draft",
  submitLabel,
  onSubmit,
  onCancel,
}: ContentFormProps) {
  const [kind, setKind] = useState<NewsKind>(defaultKind)
  const [status, setStatus] = useState<NewsStatus>(defaultStatus)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContentFormValues>({
    resolver: zodResolver(contentSchema),
    defaultValues: {
      title: "",
      category: "",
      summary: "",
      tagsInput: "",
      image: "",
      publishedAt: new Date().toISOString().slice(0, 10),
      ...defaultValues,
    },
  })

  function handleFormSubmit(values: ContentFormValues) {
    onSubmit({ ...values, kind, status })
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} noValidate>
      <Stack gap={4}>
        <Stack gap={2}>
          <Label id="content-kind-label">Content Type</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={kind}
            onValueChange={(value) => {
              if (value) setKind(value as NewsKind)
            }}
            aria-labelledby="content-kind-label"
          >
            <ToggleGroupItem value="news" className="flex-1">
              News
            </ToggleGroupItem>
            <ToggleGroupItem value="update" className="flex-1">
              Update
            </ToggleGroupItem>
          </ToggleGroup>
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="content-title">Title</Label>
          <Input
            id="content-title"
            placeholder="e.g. Scheduled Water Supply Maintenance — Block C"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "content-title-error" : undefined}
            {...register("title")}
          />
          {errors.title && (
            <Typography id="content-title-error" variant="caption" className="text-destructive" role="alert">
              {errors.title.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="content-category">Category</Label>
          <Input
            id="content-category"
            placeholder="e.g. Utilities, Community, Infrastructure"
            aria-invalid={!!errors.category}
            aria-describedby={errors.category ? "content-category-error" : undefined}
            {...register("category")}
          />
          {errors.category && (
            <Typography id="content-category-error" variant="caption" className="text-destructive" role="alert">
              {errors.category.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="content-summary">Summary</Label>
          <Textarea
            id="content-summary"
            placeholder="What should residents know? Keep it clear and factual."
            rows={4}
            aria-invalid={!!errors.summary}
            aria-describedby={errors.summary ? "content-summary-error" : undefined}
            {...register("summary")}
          />
          {errors.summary && (
            <Typography id="content-summary-error" variant="caption" className="text-destructive" role="alert">
              {errors.summary.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="content-date">Date</Label>
          <Input
            id="content-date"
            type="date"
            aria-invalid={!!errors.publishedAt}
            aria-describedby={errors.publishedAt ? "content-date-error" : undefined}
            {...register("publishedAt")}
          />
          {errors.publishedAt && (
            <Typography id="content-date-error" variant="caption" className="text-destructive" role="alert">
              {errors.publishedAt.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="content-tags">Tags</Label>
          <Input
            id="content-tags"
            placeholder="e.g. water, utilities, maintenance"
            aria-describedby="content-tags-hint"
            {...register("tagsInput")}
          />
          <Typography id="content-tags-hint" variant="caption" className="text-muted-foreground">
            Optional. Separate with commas.
          </Typography>
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="content-image">Image Path</Label>
          <Input
            id="content-image"
            placeholder="e.g. /images/news/water.jpg"
            aria-describedby="content-image-hint"
            {...register("image")}
          />
          <Typography id="content-image-hint" variant="caption" className="text-muted-foreground">
            Optional. Leave blank to use a placeholder image.
          </Typography>
        </Stack>

        <Stack gap={2}>
          <Label id="content-status-label">Publishing</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={status}
            onValueChange={(value) => {
              if (value) setStatus(value as NewsStatus)
            }}
            aria-labelledby="content-status-label"
          >
            <ToggleGroupItem value="draft" className="flex-1">
              Draft
            </ToggleGroupItem>
            <ToggleGroupItem value="published" className="flex-1">
              Published
            </ToggleGroupItem>
          </ToggleGroup>
          <Typography variant="caption" className="text-muted-foreground">
            {status === "published"
              ? "This will be visible on the public News & Daily Updates page and in Search."
              : "This will be saved as a draft and stay hidden from residents."}
          </Typography>
        </Stack>

        <Stack gap={2} className="flex-col-reverse sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </Stack>
      </Stack>
    </form>
  )
}

export { ContentForm }

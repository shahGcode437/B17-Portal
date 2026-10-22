import { useState } from "react"
import { motion } from "motion/react"
import { ArrowDown, ArrowUp, PlusCircle, Tags } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { WorkspaceEmpty } from "@/components/workspace/WorkspaceEmpty"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { useAdminCategories } from "@/hooks/useWorkspaceReads"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { useMutation } from "@/hooks/useMutation"
import { useToast } from "@/hooks/useToast"
import { createCategory, patchCategory, reorderCategories } from "@/lib/api/writes/admin"
import { userMessageFor } from "@/lib/api/writeErrors"
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
 * Categories (Phase 12H). The read is `GET /admin/categories` (inactive included); the writes are
 * `POST`, `PATCH`, `POST /reorder`. `module` and `slug` are immutable on edit; there is no delete
 * endpoint (deactivate instead). Every write refreshes the list from the server; a reorder sends the
 * COMPLETE sibling group in the new order.
 */
function AdminCategoriesPage() {
  const admin = useRequireAdminAuth()
  const read = useAdminCategories()
  const { show } = useToast()
  const [addingTo, setAddingTo] = useState<AdminCategoryView["module"] | null>(null)
  const [newName, setNewName] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const createMutation = useMutation(createCategory)
  const patchMutation = useMutation(({ id, body }: { id: string; body: Parameters<typeof patchCategory>[1] }) => patchCategory(id, body))
  const reorderMutation = useMutation(reorderCategories)

  if (!admin) return null

  const refresh = () => read.retry()

  const handleCreate = async (module: AdminCategoryView["module"]) => {
    const name = newName.trim()
    if (name.length < 2) {
      show("Please enter at least two characters.")
      return
    }
    try {
      await createMutation.mutate({ module, name })
      show("Category added")
      setAddingTo(null)
      setNewName("")
      refresh()
    } catch (error) {
      show(userMessageFor(error, "category-create").title)
    }
  }

  const handleRename = async (category: AdminCategoryView) => {
    const name = renameValue.trim()
    if (name.length < 2 || name === category.name) {
      setRenamingId(null)
      return
    }
    try {
      await patchMutation.mutate({ id: category.id, body: { name } })
      show("Category renamed")
      setRenamingId(null)
      refresh()
    } catch (error) {
      show(userMessageFor(error, "category-patch").title)
    }
  }

  const toggleActive = async (category: AdminCategoryView) => {
    try {
      await patchMutation.mutate({ id: category.id, body: { isActive: !category.isActive } })
      show(category.isActive ? "Category deactivated" : "Category activated")
      refresh()
    } catch (error) {
      show(userMessageFor(error, "category-patch").title)
    }
  }

  const move = async (module: AdminCategoryView["module"], ordered: AdminCategoryView[], index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= ordered.length) return
    const reordered = [...ordered]
    const [row] = reordered.splice(index, 1)
    reordered.splice(nextIndex, 0, row)
    try {
      await reorderMutation.mutate({ module, orderedIds: reordered.map((c) => c.id) })
      show("Order updated")
      refresh()
    } catch (error) {
      show(userMessageFor(error, "category-reorder").title)
      refresh()
    }
  }

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp}>
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">Categories</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Add, rename, re-order and deactivate categories. Modules and slugs are set at creation and never change.
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
                  const rows = read.data.filter((category) => category.module === module).slice().sort((a, b) => a.displayOrder - b.displayOrder)
                  return (
                    <WorkspaceSection key={module} title={`${label} (${rows.length})`}>
                      <Stack gap={2}>
                        {rows.map((category, index) => (
                          <Card key={category.id} variant="workspace" className="flex-row items-center justify-between gap-3 p-3">
                            <Stack direction="row" align="center" gap={1} className="shrink-0">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Move ${category.name} up`}
                                onClick={() => void move(module, rows, index, -1)}
                                disabled={index === 0 || reorderMutation.pending}
                              >
                                <ArrowUp aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Move ${category.name} down`}
                                onClick={() => void move(module, rows, index, 1)}
                                disabled={index === rows.length - 1 || reorderMutation.pending}
                              >
                                <ArrowDown aria-hidden="true" />
                              </Button>
                            </Stack>
                            <Stack gap={0} className="min-w-0 flex-1">
                              {renamingId === category.id ? (
                                <Input
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onBlur={() => void handleRename(category)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void handleRename(category)
                                    if (e.key === "Escape") setRenamingId(null)
                                  }}
                                  aria-label={`Rename ${category.name}`}
                                  autoFocus
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="w-fit text-left"
                                  onClick={() => {
                                    setRenamingId(category.id)
                                    setRenameValue(category.name)
                                  }}
                                >
                                  <Typography as="span" variant="label" className="break-words">
                                    {category.name}
                                  </Typography>
                                </button>
                              )}
                              <Typography as="span" variant="caption" className="break-words">
                                {category.slug}
                              </Typography>
                            </Stack>
                            <Stack direction="row" align="center" gap={2} className="shrink-0">
                              <Badge
                                variant={category.isActive ? "secondary" : "outline"}
                                className="shrink-0 font-normal"
                              >
                                {category.isActive ? "Active" : "Inactive"}
                              </Badge>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void toggleActive(category)}
                                disabled={patchMutation.pending}
                              >
                                {category.isActive ? "Deactivate" : "Activate"}
                              </Button>
                            </Stack>
                          </Card>
                        ))}
                        {addingTo === module ? (
                          <Stack direction="row" gap={2}>
                            <Label className="sr-only" htmlFor={`new-${module}`}>
                              New {label} category name
                            </Label>
                            <Input
                              id={`new-${module}`}
                              value={newName}
                              onChange={(e) => setNewName(e.target.value)}
                              placeholder="New category name"
                              autoFocus
                            />
                            <Button type="button" onClick={() => void handleCreate(module)} disabled={createMutation.pending}>
                              {createMutation.pending ? "Adding…" : "Add"}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => setAddingTo(null)}>
                              Cancel
                            </Button>
                          </Stack>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-fit"
                            onClick={() => {
                              setAddingTo(module)
                              setNewName("")
                            }}
                          >
                            <PlusCircle aria-hidden="true" />
                            Add a {label} category
                          </Button>
                        )}
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

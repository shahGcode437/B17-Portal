import { useId, useState, type FormEvent } from "react"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { GroceryField } from "@/features/grocery/GroceryField"
import { describedBy, groceryInputClass, grocerySelectClass } from "@/features/grocery/fieldStyles"
import { ALL_STATUSES, STATUS_META } from "@/features/grocery/orderStatus"
import { segmentItemClass } from "@/features/admin/adminStyles"
import { DEFAULT_FILTERS, filterSearch, referenceProblem, type QueueFilters } from "@/features/grocery-staff/queueFilters"
import type { GroceryQueuePage } from "@/lib/api/reads/groceryStaff"

interface StaffQueueFiltersProps {
  filters: QueueFilters
  /** The server's per-status counts under the OTHER filters; undefined while unknown. */
  counts: GroceryQueuePage["counts"] | undefined
  /** The colleague's name, when the queue is filtered to one and a row has told us it. */
  colleague: string | undefined
  onChange: (patch: Partial<QueueFilters>) => void
  onClear: () => void
}

function ReferenceSearch({ value, onSearch }: { value: string; onSearch: (reference: string) => void }) {
  const id = useId()
  const [text, setText] = useState(value)
  const [error, setError] = useState<string>()

  function submit(event: FormEvent) {
    event.preventDefault()
    const problem = referenceProblem(text) ?? undefined
    setError(problem)
    if (!problem) onSearch(text.trim())
  }

  return (
    <form role="search" noValidate onSubmit={submit} className="col-span-2 flex items-start gap-2">
      <GroceryField id={id} label="Order reference" error={error} className="flex-1">
        <Input
          id={id}
          type="search"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={16}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className={groceryInputClass}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error)}
        />
      </GroceryField>
      {/* Lined up with the input, under the label. */}
      <Button type="submit" variant="outline" className="mt-5 h-11">
        <Search aria-hidden="true" />
        Search
      </Button>
    </form>
  )
}

function StaffQueueFilters({ filters, counts, colleague, onChange, onClear }: StaffQueueFiltersProps) {
  const id = useId()
  const total = counts ? ALL_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0) : undefined
  const changed = filterSearch({ ...filters, page: 1 }) !== filterSearch(DEFAULT_FILTERS)
  const otherStaff = filters.assigned && filters.assigned !== "me" && filters.assigned !== "unassigned"

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        type="single"
        variant="outline"
        value={filters.status}
        onValueChange={(value) => value && onChange({ status: value as QueueFilters["status"] })}
        aria-label="Filter by status"
        className="flex-wrap"
      >
        {[...ALL_STATUSES, "all" as const].map((status) => (
          <ToggleGroupItem key={status} value={status} className={segmentItemClass}>
            {status === "all" ? "All" : STATUS_META[status].label} (
            {status === "all" ? (total ?? "…") : counts ? (counts[status] ?? 0) : "…"})
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {/* Remounted when the address changes, so the box always shows the search in force. */}
        <ReferenceSearch key={filters.reference} value={filters.reference} onSearch={(reference) => onChange({ reference })} />
        <GroceryField id={`${id}-assigned`} label="Assigned to">
          <select
            id={`${id}-assigned`}
            value={filters.assigned}
            onChange={(event) => onChange({ assigned: event.target.value })}
            className={grocerySelectClass}
          >
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Nobody yet</option>
            {otherStaff && <option value={filters.assigned}>{colleague ?? "A colleague"}</option>}
          </select>
        </GroceryField>
        <GroceryField id={`${id}-day`} label="Sent on">
          <Input
            id={`${id}-day`}
            type="date"
            value={filters.submittedOn}
            onChange={(event) => onChange({ submittedOn: event.target.value })}
            className={groceryInputClass}
          />
        </GroceryField>
        <GroceryField id={`${id}-sort`} label="Order">
          <select
            id={`${id}-sort`}
            value={filters.sort}
            onChange={(event) => onChange({ sort: event.target.value as QueueFilters["sort"] })}
            className={grocerySelectClass}
          >
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </GroceryField>
      </div>
      {changed && (
        <Button type="button" variant="ghost" className="h-11 self-start" onClick={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  )
}

export { StaffQueueFilters }

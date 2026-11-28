import { useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { AnimatePresence, motion } from "motion/react"
import { ArrowRight, ShoppingBasket } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/workspace/PageHeader"
import { ReadError } from "@/components/feedback/ReadError"
import { FormAlert } from "@/components/forms/FormAlert"
import { AvailabilityStatus } from "@/features/grocery/AvailabilityStatus"
import { canWriteAnOrder } from "@/features/grocery/availabilityCopy"
import { HiddenDraftPanel, SentNotice, UnconfirmedBanner } from "@/features/grocery/GroceryNotices"
import { GrocerySteps } from "@/features/grocery/GrocerySteps"
import { GroceryUnavailable } from "@/features/grocery/GroceryUnavailable"
import { ItemForm } from "@/features/grocery/ItemForm"
import { ItemRow } from "@/features/grocery/ItemRow"
import { RecoveryNotice } from "@/features/grocery/RecoveryNotice"
import { useGroceryAvailability } from "@/features/grocery/useGroceryAvailability"
import { isDraftHidden, useGroceryDraft } from "@/features/grocery/groceryDraftStore"
import { useAuth } from "@/hooks/useAuth"
import { routes } from "@/config/routes"
import { duration, easing } from "@/lib/motion"
import type { GroceryAvailabilityDto } from "@/lib/api/dto/grocery"

function ListBuilder({ availability, onRefresh, refreshing }: { availability: GroceryAvailabilityDto; onRefresh: () => void; refreshing: boolean }) {
  const navigate = useNavigate()
  const { status } = useAuth()
  const items = useGroceryDraft((draft) => draft.items)
  const phase = useGroceryDraft((draft) => draft.phase)
  const { addItem, updateItem, removeItem } = useGroceryDraft.getState()
  const [editing, setEditing] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const addCard = useRef<HTMLDivElement>(null)

  const max = availability.limits.maxItemsPerOrder
  const full = items.length >= max
  const locked = phase !== "idle"

  function next() {
    if (editing) return setBlocked("Save or cancel the item you're editing first.")
    if (pending) {
      addCard.current?.querySelector("input")?.focus()
      return setBlocked("You typed an item that isn't on your list yet. Add it, or clear the fields.")
    }
    if (items.length === 0) return setBlocked("Add at least one item to your list.")
    if (items.length > max) return setBlocked(`One order can have at most ${max} items. Remove ${items.length - max} to continue.`)
    navigate(routes.groceryDelivery)
  }

  return (
    <div className="flex flex-col gap-5">
      {!availability.acceptingOrders && (
        <AvailabilityStatus availability={availability} onRefresh={onRefresh} refreshing={refreshing} />
      )}
      {phase === "unconfirmed" && <UnconfirmedBanner />}
      {status === "anonymous" && (
        <FormAlert
          tone="info"
          role="status"
          title="You can write your list now and sign in at the next step"
          action={
            <>
              Signing in with Google reloads the page and the list isn't kept, so with Google{" "}
              <Link to={routes.login} state={{ from: routes.groceryNew }} className="font-medium text-primary underline underline-offset-4">
                sign in first
              </Link>
              .
            </>
          }
        />
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section aria-labelledby="grocery-add" ref={addCard} className="glass-panel rounded-2xl p-4 sm:p-5">
          <Typography as="h2" id="grocery-add" variant="h3" className="mb-3 text-lg">
            Add an item
          </Typography>
          {locked ? (
            <Typography variant="body-sm" className="text-muted-foreground">
              Your list is locked until your last order is confirmed.
            </Typography>
          ) : full ? (
            <Typography variant="body-sm" role="status">
              Your list has the most items one order allows ({max}).
            </Typography>
          ) : (
            <ItemForm
              units={availability.units}
              substitutionOptions={availability.substitutionOptions}
              submitLabel="Add to list"
              onDirtyChange={(dirty) => {
                setPending(dirty)
                setBlocked(null)
              }}
              onSave={(values) => {
                addItem(values)
                setPending(false)
                setBlocked(null)
                setAnnouncement(`Added ${values.name}.`)
              }}
            />
          )}
        </section>

        <section aria-labelledby="grocery-list" className="flex min-w-0 flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <Typography as="h2" id="grocery-list" variant="h3" className="text-lg">
              Your list
            </Typography>
            <Typography variant="body-sm" className="tabular-nums text-muted-foreground">
              {items.length} of {max} items
            </Typography>
          </div>
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center">
              <ShoppingBasket className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
              <Typography variant="body-sm" className="mt-2 text-muted-foreground">
                Nothing yet. Add your first item: for example rice, eggs or milk.
              </Typography>
            </div>
          ) : (
            <ol aria-label="Grocery items" className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {items.map((item, index) => (
                  <motion.li
                    key={item.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: duration.hover, ease: easing.standard }}
                    className="glass-panel rounded-2xl p-3"
                  >
                    {editing === item.id && !locked ? (
                      <ItemForm
                        autoFocus
                        units={availability.units}
                        substitutionOptions={availability.substitutionOptions}
                        initial={item}
                        submitLabel="Save item"
                        onCancel={() => setEditing(null)}
                        onSave={(values) => {
                          updateItem(item.id, values)
                          setEditing(null)
                          setBlocked(null)
                          setAnnouncement(`Saved ${values.name}.`)
                        }}
                      />
                    ) : (
                      <ItemRow
                        number={index + 1}
                        name={item.name}
                        quantity={item.quantity}
                        unit={item.unit}
                        preferredBrand={item.preferredBrand}
                        substitution={item.substitution}
                        note={item.note}
                        disabled={locked}
                        onEdit={() => {
                          setEditing(item.id)
                          setBlocked(null)
                        }}
                        onRemove={() => {
                          removeItem(item.id)
                          setBlocked(null)
                          setAnnouncement(`Removed ${item.name}.`)
                        }}
                      />
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          )}
        </section>
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* On phones the next step stays reachable above the bottom navigation. */}
      <div className="sticky bottom-[4.5rem] z-10 flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-elevated lg:bottom-4">
        {blocked && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {blocked}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <Typography variant="body-sm" className="min-w-0 text-muted-foreground">
            Total price confirmed before preparation.
          </Typography>
          {locked ? (
            <Button asChild className="h-11 shrink-0 px-4">
              <Link to={routes.groceryReview}>Review</Link>
            </Button>
          ) : (
            <Button type="button" className="h-11 shrink-0 px-4" onClick={next}>
              Continue
              <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Step 1: the list (GROCERY-3A). Units, limits and substitution choices come from the server. */
function GroceryListPage() {
  const availability = useGroceryAvailability()
  const { user, status } = useAuth()
  const ownerId = useGroceryDraft((draft) => draft.ownerId)
  const count = useGroceryDraft((draft) => draft.items.length)
  const hidden = isDraftHidden(ownerId, user?.id ?? null)
  const data = availability.data

  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <PageHeader
          icon={ShoppingBasket}
          eyebrow="Grocery"
          title="Your grocery list"
          description="Add each thing you need, with how much of it."
          meta={<GrocerySteps current={1} />}
        />
        <SentNotice />
        <RecoveryNotice />
        {hidden && status === "loading" ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : hidden ? (
          <HiddenDraftPanel from={routes.groceryNew} />
        ) : availability.loading ? (
          <div role="status" aria-label="Loading the order form" className="flex flex-col gap-3">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : !data ? (
          availability.error && (
            <ReadError error={availability.error} onRetry={availability.refresh} title="Couldn't load the order form" />
          )
        ) : !canWriteAnOrder(data) ? (
          <GroceryUnavailable availability={data} keptItems={count} />
        ) : (
          <ListBuilder availability={data} onRefresh={availability.refresh} refreshing={availability.refreshing} />
        )}
      </div>
    </Container>
  )
}

export { GroceryListPage }

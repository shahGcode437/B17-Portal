import { useEffect, useId } from "react"
import { Navigate, useNavigate, Link } from "react-router-dom"
import { useForm } from "react-hook-form"
import { ArrowLeft, ArrowRight, MapPin, ShieldCheck } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/workspace/PageHeader"
import { ReadError } from "@/components/feedback/ReadError"
import { AvailabilityStatus } from "@/features/grocery/AvailabilityStatus"
import { canWriteAnOrder } from "@/features/grocery/availabilityCopy"
import { GroceryField } from "@/features/grocery/GroceryField"
import { describedBy, groceryInputClass, grocerySelectClass } from "@/features/grocery/fieldStyles"
import { GrocerySteps } from "@/features/grocery/GrocerySteps"
import { GroceryUnavailable } from "@/features/grocery/GroceryUnavailable"
import { AuthUnreachable, SignInPanel, VerifyToOrder } from "@/features/grocery/SignInGatePanel"
import { LIMITS, deliverySchema, type DeliveryValues } from "@/features/grocery/orderRequest"
import { useGroceryAvailability } from "@/features/grocery/useGroceryAvailability"
import { isDraftHidden, useGroceryDraft } from "@/features/grocery/groceryDraftStore"
import { useAuth } from "@/hooks/useAuth"
import { routes } from "@/config/routes"
import { MAX_PHONE_LENGTH, PHONE_EXAMPLE } from "@/lib/phone"
import { zodResolver } from "@/lib/zodResolver"
import type { CurrentUser } from "@/types/auth"

function DeliveryForm({ blocks, user }: { blocks: string[]; user: CurrentUser }) {
  const id = useId()
  const navigate = useNavigate()
  const saved = useGroceryDraft.getState().delivery
  const { setDelivery } = useGroceryDraft.getState()
  const {
    register,
    handleSubmit,
    subscribe,
    formState: { errors },
  } = useForm<DeliveryValues>({
    resolver: zodResolver<DeliveryValues>(deliverySchema(blocks)),
    defaultValues: {
      ...saved,
      contactName: saved.contactName || user.displayName,
      block: blocks.includes(saved.block) ? saved.block : "",
    },
  })

  // Keep what is typed in the in-memory draft, so Back / Forward and a round trip to Log In keep it.
  useEffect(() => subscribe({ formState: { values: true }, callback: ({ values }) => setDelivery(values) }), [subscribe, setDelivery])

  const next = handleSubmit((values) => {
    setDelivery(values)
    navigate(routes.groceryReview)
  })

  const field = (name: keyof DeliveryValues, hint = false) => ({
    id: `${id}-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": describedBy(`${id}-${name}`, errors[name]?.message, hint),
  })

  return (
    <form noValidate onSubmit={(event) => void next(event)} className="flex flex-col gap-4">
      <fieldset className="glass-panel flex flex-col gap-4 rounded-2xl p-4 sm:p-5">
        <legend className="sr-only">Who to contact</legend>
        <GroceryField id={`${id}-contactName`} label="Contact name" error={errors.contactName?.message}>
          <Input {...field("contactName")} {...register("contactName")} autoComplete="name" maxLength={LIMITS.contactName} className={groceryInputClass} />
        </GroceryField>
        <GroceryField
          id={`${id}-contactPhone`}
          label="Phone number"
          hint={`Our team calls this number about the price. For example ${PHONE_EXAMPLE}.`}
          error={errors.contactPhone?.message}
        >
          <Input
            {...field("contactPhone", true)}
            {...register("contactPhone")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={MAX_PHONE_LENGTH}
            className={groceryInputClass}
          />
        </GroceryField>
      </fieldset>

      <fieldset className="glass-panel flex flex-col gap-4 rounded-2xl p-4 sm:p-5">
        <legend className="sr-only">Where to deliver</legend>
        <GroceryField id={`${id}-block`} label="Block" hint="Only the blocks we deliver to are listed." error={errors.block?.message}>
          <select {...field("block", true)} {...register("block")} className={grocerySelectClass}>
            <option value="">Choose your block</option>
            {blocks.map((block) => (
              <option key={block} value={block}>
                {block}
              </option>
            ))}
          </select>
        </GroceryField>
        <GroceryField id={`${id}-addressLine`} label="House and street" error={errors.addressLine?.message}>
          <Input {...field("addressLine")} {...register("addressLine")} autoComplete="street-address" maxLength={LIMITS.address} className={groceryInputClass} />
        </GroceryField>
        <GroceryField id={`${id}-landmark`} label="Landmark" optional error={errors.landmark?.message}>
          <Input {...field("landmark")} {...register("landmark")} maxLength={LIMITS.landmark} className={groceryInputClass} />
        </GroceryField>
        <GroceryField id={`${id}-instructions`} label="Delivery or order instructions" optional error={errors.instructions?.message}>
          <Textarea {...field("instructions")} {...register("instructions")} rows={3} maxLength={LIMITS.instructions} className="min-h-24 text-base md:text-base" />
        </GroceryField>
      </fieldset>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        These details are used for this order. They aren't saved on this device.
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button asChild variant="outline" className="h-11">
          <Link to={routes.groceryNew}>
            <ArrowLeft />
            Back to list
          </Link>
        </Button>
        <Button type="submit" className="h-11 sm:px-6">
          Review order
          <ArrowRight />
        </Button>
      </div>
    </form>
  )
}

/** Step 2: delivery details (GROCERY-3A). Blocks come from the server; a signed-in account is required. */
function GroceryDeliveryPage() {
  const { user, status } = useAuth()
  const availability = useGroceryAvailability()
  const ownerId = useGroceryDraft((draft) => draft.ownerId)
  const count = useGroceryDraft((draft) => draft.items.length)
  const phase = useGroceryDraft((draft) => draft.phase)
  const sentOrderId = useGroceryDraft((draft) => draft.sentOrderId)
  const hidden = isDraftHidden(ownerId, user?.id ?? null)

  if (phase !== "idle") return <Navigate to={routes.groceryReview} replace />
  // A hidden or empty list has no delivery step: the list page explains which it is.
  if (status !== "loading" && (hidden || count === 0)) {
    return <Navigate to={sentOrderId ? routes.grocery : routes.groceryNew} replace />
  }

  const data = availability.data
  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <PageHeader
          icon={MapPin}
          eyebrow="Grocery"
          title="Delivery details"
          description={`${count === 1 ? "1 item" : `${count} items`} on your list. Where should we bring it?`}
          meta={<GrocerySteps current={2} />}
        />
        {status === "loading" ? (
          <Skeleton className="h-80 rounded-2xl" />
        ) : status === "unavailable" ? (
          <AuthUnreachable />
        ) : !user ? (
          <SignInPanel from={routes.groceryDelivery} />
        ) : availability.loading ? (
          <div role="status" aria-label="Loading delivery areas">
            <Skeleton className="h-80 rounded-2xl" />
          </div>
        ) : !data ? (
          availability.error && (
            <ReadError error={availability.error} onRetry={availability.refresh} title="Couldn't load the delivery areas" />
          )
        ) : !canWriteAnOrder(data) ? (
          <GroceryUnavailable availability={data} keptItems={count} />
        ) : (
          <>
            <VerifyToOrder />
            {!data.acceptingOrders && (
              <AvailabilityStatus availability={data} onRefresh={availability.refresh} refreshing={availability.refreshing} />
            )}
            <DeliveryForm key={user.id} blocks={data.serviceableBlocks} user={user} />
          </>
        )}
        {status !== "loading" && !user && (
          <Typography variant="body-sm" className="text-center">
            <Link to={routes.groceryNew} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
              Back to your list
            </Link>
          </Typography>
        )}
      </div>
    </Container>
  )
}

export { GroceryDeliveryPage }

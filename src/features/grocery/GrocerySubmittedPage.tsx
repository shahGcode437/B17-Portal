import { useEffect } from "react"
import { Link, Navigate, useParams } from "react-router-dom"
import { motion } from "motion/react"
import { Banknote, Check, ClipboardList, PhoneCall, Truck } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { useGroceryDraft } from "@/features/grocery/groceryDraftStore"
import { offeredMethods, paymentCopy } from "@/features/grocery/paymentCopy"
import { useGroceryAvailability } from "@/features/grocery/useGroceryAvailability"
import { useRead } from "@/hooks/useRead"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { fetchMyGroceryOrder } from "@/lib/api/reads/grocery"
import { groceryOrderPath, routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

const NEXT = [
  { icon: PhoneCall, text: "Our team calls the number you gave to confirm availability, your order and the total price." },
  { icon: Truck, text: "We prepare your order and deliver it to your door." },
]

/** The confirmation of a sent order (GROCERY-3A). It shows what the SERVER holds, read again. */
function GrocerySubmittedPage() {
  const { orderId = "" } = useParams()
  const user = useRequireAuth()
  const acknowledge = useGroceryDraft((draft) => draft.acknowledgeSent)
  const read = useRead(`grocery-sent:${user?.id ?? ""}:${orderId}`, (signal) => fetchMyGroceryOrder(orderId, signal), {
    enabled: Boolean(user),
  })

  const payment = paymentCopy(offeredMethods(useGroceryAvailability().data))
  const next = [...NEXT, { icon: Banknote, text: payment.howToPay }]

  useEffect(() => acknowledge(), [acknowledge])

  if (!user) return null
  // This page is the first view of a NEW order. Any other order opens as what it is.
  if (read.status === "success" && read.data.status !== "submitted") return <Navigate to={groceryOrderPath(orderId)} replace />

  return (
    <Container className="py-8 sm:py-12">
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        {read.status === "loading" ? (
          <div role="status" aria-label="Loading your order">
            <Skeleton className="h-96 rounded-3xl" />
          </div>
        ) : read.status === "error" ? (
          <>
            <ReadError error={read.error} onRetry={read.retry} headingLevel={1} title="Couldn't load that order" />
            <Button asChild variant="outline" className="h-11 self-center">
              <Link to={routes.profileGrocery}>My Grocery Orders</Link>
            </Button>
          </>
        ) : (
          <motion.div {...fadeUp} className="glass-panel flex flex-col items-center gap-5 rounded-3xl p-6 text-center sm:p-8">
            <motion.span
              aria-hidden="true"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
              className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <Check className="size-8" />
            </motion.span>
            <div className="flex flex-col gap-1">
              <Typography variant="h1" className="text-2xl sm:text-3xl">
                Order sent
              </Typography>
              <Typography variant="body" className="text-muted-foreground">
                Your reference is
              </Typography>
              <p className="select-all font-heading text-2xl font-semibold tracking-wide">{read.data.reference}</p>
              <Typography variant="body-sm" className="text-muted-foreground">
                {read.data.itemCount === 1 ? "1 item" : `${read.data.itemCount} items`}. Total price to be confirmed.
              </Typography>
            </div>
            <ul aria-label="What happens next" className="flex w-full flex-col gap-3 text-left">
              {next.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3 text-sm">
                  <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <Icon className="size-4" />
                  </span>
                  <span className="pt-1">{text}</span>
                </li>
              ))}
            </ul>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
              <Button asChild className="h-11">
                <Link to={groceryOrderPath(orderId)}>Track this order</Link>
              </Button>
              <Button asChild variant="outline" className="h-11">
                <Link to={routes.profileGrocery}>
                  <ClipboardList />
                  My Grocery Orders
                </Link>
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </Container>
  )
}

export { GrocerySubmittedPage }

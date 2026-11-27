import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { Banknote, ClipboardList, Clock, ListPlus, MapPin, PhoneCall, ShoppingBasket, Truck, type LucideIcon } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { AvailabilityStatus } from "@/features/grocery/AvailabilityStatus"
import { canWriteAnOrder } from "@/features/grocery/availabilityCopy"
import { SentNotice } from "@/features/grocery/GroceryNotices"
import { useGroceryAvailability } from "@/features/grocery/useGroceryAvailability"
import { isDraftHidden, useGroceryDraft } from "@/features/grocery/groceryDraftStore"
import { formatDays, formatHours } from "@/features/grocery/format"
import { useAuth } from "@/hooks/useAuth"
import { routes } from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
import type { GroceryAvailabilityDto } from "@/lib/api/dto/grocery"

const HOW_IT_WORKS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ListPlus,
    title: "Send your list",
    text: "Write what you need, with quantities, a preferred brand and whether a substitute is fine.",
  },
  {
    icon: PhoneCall,
    title: "We call about the price",
    text: "Our team agrees the price with you by phone before buying anything. There is no price list in the app.",
  },
  {
    icon: Truck,
    title: "We shop and deliver",
    text: "We buy your items from local shops and bring them to your door in the areas we serve.",
  },
  {
    icon: Banknote,
    title: "Pay cash on delivery",
    text: "Pay in cash when your order arrives. Nothing is paid online.",
  },
]

function HowItWorks() {
  return (
    <section aria-labelledby="grocery-how">
      <Typography as="h2" id="grocery-how" variant="h2" className="mb-4 text-xl sm:text-2xl">
        How it works
      </Typography>
      <motion.ol
        initial="initial"
        animate="animate"
        variants={staggerContainer}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {HOW_IT_WORKS.map(({ icon: Icon, title, text }, index) => (
          <motion.li key={title} variants={staggerItem} className="glass-panel flex gap-3 rounded-2xl p-4 lg:flex-col">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <Icon className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <Typography as="h3" variant="label" className="text-base font-semibold">
                <span className="sr-only">Step {index + 1}: </span>
                {title}
              </Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                {text}
              </Typography>
            </div>
          </motion.li>
        ))}
      </motion.ol>
    </section>
  )
}

function Detail({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel flex flex-col gap-2 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Icon className="size-4.5 text-primary" aria-hidden="true" />
        <Typography as="h3" variant="label" className="text-base font-semibold">
          {title}
        </Typography>
      </div>
      {children}
    </div>
  )
}

function ServiceDetails({ availability }: { availability: GroceryAvailabilityDto }) {
  return (
    <section aria-label="Opening hours, areas and payment" className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Detail icon={Clock} title="Opening hours">
        <Typography variant="body-sm">{formatDays(availability.schedule.operatingDays)}</Typography>
        <Typography variant="body-sm">{formatHours(availability.schedule)}</Typography>
      </Detail>
      <Detail icon={MapPin} title="Delivery areas">
        {availability.serviceableBlocks.length > 0 ? (
          <ul aria-label="Blocks we deliver to" className="flex flex-wrap gap-1.5">
            {availability.serviceableBlocks.map((block) => (
              <li key={block} className="rounded-full bg-secondary px-3 py-1 text-sm">
                {block}
              </li>
            ))}
          </ul>
        ) : (
          <Typography variant="body-sm" className="text-muted-foreground">
            No delivery areas are set up at the moment.
          </Typography>
        )}
      </Detail>
      <Detail icon={Banknote} title="Price and payment">
        <Typography variant="body-sm">
          Our team confirms the full price with you before preparing your order, including any service or delivery fee.
        </Typography>
        <Typography variant="body-sm">Cash on delivery only.</Typography>
      </Detail>
    </section>
  )
}

/**
 * Grocery, the landing page (GROCERY-3A). Everything about whether ordering works right now comes
 * from `GET /grocery/availability`; nothing is assumed. "My Grocery Orders" is always offered, so
 * existing orders stay reachable when new ones are switched off.
 */
function GroceryLandingPage() {
  const availability = useGroceryAvailability()
  const { user } = useAuth()
  const ownerId = useGroceryDraft((draft) => draft.ownerId)
  const draftCount = useGroceryDraft((draft) => draft.items.length)
  const visibleCount = isDraftHidden(ownerId, user?.id ?? null) ? 0 : draftCount

  const data = availability.data
  const writable = data ? canWriteAnOrder(data) : false
  const startLabel =
    visibleCount > 0
      ? `Continue your list (${visibleCount})`
      : data?.acceptingOrders
        ? "Start your grocery list"
        : "Prepare a list"

  return (
    <Container className="py-8 sm:py-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <motion.div {...fadeUp} className="glass-panel relative overflow-hidden rounded-3xl p-5 sm:p-8">
          <Stack gap={4} className="max-w-2xl">
            <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <ShoppingBasket className="size-6" />
            </span>
            <Typography variant="h1">Grocery</Typography>
            <Typography variant="body-lg" className="text-muted-foreground">
              Send us your grocery list. We agree the price with you by phone, buy it from local shops, deliver it and
              take cash.
            </Typography>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {writable && (
                <Button asChild size="lg" className="h-11 px-5">
                  <Link to={routes.groceryNew}>
                    <ListPlus />
                    {startLabel}
                  </Link>
                </Button>
              )}
              <Button asChild size="lg" variant="outline" className="h-11 px-5">
                <Link to={routes.profileGrocery}>
                  <ClipboardList />
                  My Grocery Orders
                </Link>
              </Button>
            </div>
            {data && writable && !data.acceptingOrders && (
              <Typography variant="body-sm" className="text-muted-foreground">
                You can write your list now; it can only be sent while orders are being accepted. Keep this tab open: the
                list isn't saved on your device.
              </Typography>
            )}
          </Stack>
        </motion.div>

        <SentNotice />

        {data ? (
          <AvailabilityStatus availability={data} onRefresh={availability.refresh} refreshing={availability.refreshing} />
        ) : availability.loading ? (
          <div role="status" aria-label="Checking whether orders are being accepted">
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : availability.error ? (
          <ReadError error={availability.error} onRetry={availability.refresh} title="Couldn't check whether ordering is open" />
        ) : null}

        <HowItWorks />
        {data && <ServiceDetails availability={data} />}
      </div>
    </Container>
  )
}

export { GroceryLandingPage }

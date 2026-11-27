import { Link } from "react-router-dom"
import { ArrowRight, ShoppingBasket } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { routes } from "@/config/routes"

/**
 * The way into Grocery from Home (GROCERY-3A). It describes the service and does not claim orders
 * are being accepted: the Grocery page asks the server and says so.
 */
function GroceryPromo() {
  return (
    <Container as="section" aria-labelledby="home-grocery" className="py-4 sm:py-6">
      <div className="glass-panel flex flex-col gap-4 rounded-3xl p-5 sm:flex-row sm:items-center sm:p-6">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <ShoppingBasket className="size-6" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Typography as="h2" id="home-grocery" variant="h3">
            Grocery by request
          </Typography>
          <Typography variant="body-sm" className="text-muted-foreground">
            Send your grocery list. Our team agrees the price with you by phone, buys it locally and delivers. Cash on
            delivery.
          </Typography>
        </div>
        <Button asChild size="lg" className="h-11 shrink-0 px-5">
          <Link to={routes.grocery}>
            How Grocery works
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </Container>
  )
}

export { GroceryPromo }

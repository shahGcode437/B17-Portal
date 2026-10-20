import { Container } from "@/components/foundation/Container"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { CategoryTiles } from "@/components/cards/CategoryTiles"
import { serviceIconFor } from "@/config/categoryIcons"
import { useCategories } from "@/hooks/useCategories"
import { routes } from "@/config/routes"

/**
 * Construction/Home Services categories (Project Overview §4) - the client's initial supply focus,
 * given strong homepage prominence. The tiles are the active service categories from
 * `GET /categories`, so an admin-added or deactivated category is reflected here without a code change.
 */
function ConstructionServices() {
  const categories = useCategories("services")

  return (
    <section className="bg-secondary/30">
      <Container className="py-12 sm:py-16">
        <SectionHeader
          title="Home & Construction Services"
          description="Our strongest local supply — construction and home-related providers."
          viewAllPath={routes.services}
        />
        <CategoryTiles
          read={categories}
          noun="service categories"
          cols={5}
          compact
          iconFor={serviceIconFor}
          hrefFor={(category) => `${routes.search}?type=provider&category=${encodeURIComponent(category.slug)}`}
        />
      </Container>
    </section>
  )
}

export { ConstructionServices }

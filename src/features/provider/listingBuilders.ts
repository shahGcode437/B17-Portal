import type { Provider } from "@/types/provider"
import type { Business } from "@/types/business"
import type { Property, ListingType, FurnishingStatus } from "@/types/property"
import type { ServiceCategorySlug } from "@/types/category"
import { parseTags, type ListingFormValues, type PropertyFormValues } from "@/features/provider/listingSchema"
import { serviceCategories } from "@/data/serviceCategories"

/**
 * Onboarding/edit form values -> domain object builders (Onboarding, extended
 * Phase 9D for Edit Listing). Kept in their own module, not inside a page
 * component, so both ListingFormPage (create) and EditListingPage (edit)
 * can share them without a component file exporting non-component values.
 */
export function buildProvider(values: ListingFormValues, id: string): Provider {
  const category = serviceCategories.find((c) => c.slug === values.category)
  return {
    id,
    name: values.name,
    category: (category?.slug ?? values.category) as ServiceCategorySlug,
    categoryLabel: category?.label ?? values.category,
    description: values.description,
    area: values.area,
    tags: parseTags(values.tagsInput),
    image: values.image,
  }
}

export function buildBusiness(values: ListingFormValues, id: string): Business {
  return {
    id,
    name: values.name,
    category: values.category,
    description: values.description,
    area: values.area,
    tags: parseTags(values.tagsInput),
    image: values.image,
  }
}

export function buildProperty(values: PropertyFormValues, id: string): Property {
  const bedrooms = values.bedrooms?.trim() ? Number(values.bedrooms) : undefined
  return {
    id,
    title: values.title,
    listingType: values.listingType as ListingType,
    propertyType: values.propertyType,
    price: values.price,
    area: values.area,
    description: values.description,
    bedrooms: bedrooms !== undefined && !Number.isNaN(bedrooms) ? bedrooms : undefined,
    furnished: values.furnished ? (values.furnished as FurnishingStatus) : undefined,
    tags: values.tagsInput ? parseTags(values.tagsInput) : [],
    image: values.image,
  }
}

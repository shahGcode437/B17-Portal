import { Hero } from "@/features/home/sections/Hero"
import { QuickCategories } from "@/features/home/sections/QuickCategories"
import { ConstructionServices } from "@/features/home/sections/ConstructionServices"
import { FeaturedProviders } from "@/features/home/sections/FeaturedProviders"
import { BusinessPreview } from "@/features/home/sections/BusinessPreview"
import { EducationPreview } from "@/features/home/sections/EducationPreview"
import { PropertyPreview } from "@/features/home/sections/PropertyPreview"
import { NewsPreview } from "@/features/home/sections/NewsPreview"
import { SponsoredSection } from "@/features/home/sections/SponsoredSection"
import { FutureModules } from "@/features/home/sections/FutureModules"
import { FinalCta } from "@/features/home/sections/FinalCta"
import { ResultPreviewDialog } from "@/components/overlay/ResultPreviewDialog"
import { useResultPreview } from "@/hooks/useResultPreview"

/**
 * B-17 Portal Home (Prototype Scope §7, UI/UX Spec §7). Section order
 * follows the documented homepage hierarchy: Hero → Quick Categories →
 * Construction Services → Featured Providers → Directory → Education →
 * Property → News → Sponsored → Future Modules → Final CTA.
 */
function HomePage() {
  const preview = useResultPreview()

  return (
    <>
      <Hero />
      <QuickCategories />
      <ConstructionServices />
      <FeaturedProviders onSelect={preview.open} />
      <BusinessPreview onSelect={preview.open} />
      <EducationPreview onSelect={preview.open} />
      <PropertyPreview onSelect={preview.open} />
      <NewsPreview onSelect={preview.open} />
      <SponsoredSection />
      <FutureModules />
      <FinalCta />
      <ResultPreviewDialog result={preview.selected} onOpenChange={preview.onOpenChange} />
    </>
  )
}

export { HomePage }

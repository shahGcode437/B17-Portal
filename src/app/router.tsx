import { lazy, type ComponentType } from "react"
import { createBrowserRouter } from "react-router-dom"
import { ConsumerLayout } from "@/app/ConsumerLayout"
import { ProviderLayout } from "@/app/ProviderLayout"
import { AdminLayout } from "@/app/AdminLayout"
import { HomePage } from "@/features/home/HomePage"
import { ComingSoonPage } from "@/features/future-modules/ComingSoonPage"
import { NotFoundPage } from "@/features/future-modules/NotFoundPage"
import { routes } from "@/config/routes"

/**
 * Route-level code splitting (Phase 9H): every page except Home (the common
 * landing screen) and the tiny ComingSoon / NotFound stubs is loaded on demand.
 * Pages use named exports, so this adapts a dynamic import to React.lazy's
 * default-export contract. The layout shells stay eager (they are small and
 * every route needs one) and render the Suspense fallback around their Outlet.
 */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => ({ default: (await load())[name] }))
}

const SearchPage = lazyPage(() => import("@/features/search/SearchPage"), "SearchPage")
const ServicesPage = lazyPage(() => import("@/features/services/ServicesPage"), "ServicesPage")
const ProviderProfilePage = lazyPage(() => import("@/features/services/ProviderProfilePage"), "ProviderProfilePage")
const DirectoryPage = lazyPage(() => import("@/features/directory/DirectoryPage"), "DirectoryPage")
const FoodPage = lazyPage(() => import("@/features/food/FoodPage"), "FoodPage")
const BusinessProfilePage = lazyPage(() => import("@/features/directory/BusinessProfilePage"), "BusinessProfilePage")
const EducationPage = lazyPage(() => import("@/features/education/EducationPage"), "EducationPage")
const TutorProfilePage = lazyPage(() => import("@/features/education/TutorProfilePage"), "TutorProfilePage")
const PropertyPage = lazyPage(() => import("@/features/property/PropertyPage"), "PropertyPage")
const PropertyDetailsPage = lazyPage(() => import("@/features/property/PropertyDetailsPage"), "PropertyDetailsPage")
const NewsListPage = lazyPage(() => import("@/features/news/NewsListPage"), "NewsListPage")
const NewsArticlePage = lazyPage(() => import("@/features/news/NewsArticlePage"), "NewsArticlePage")
const LoginRegisterPage = lazyPage(() => import("@/features/auth/LoginRegisterPage"), "LoginRegisterPage")
const ResidentOverviewPage = lazyPage(() => import("@/features/resident/ResidentOverviewPage"), "ResidentOverviewPage")
const SavedPage = lazyPage(() => import("@/features/resident/SavedPage"), "SavedPage")
const MyRequestsPage = lazyPage(() => import("@/features/resident/MyRequestsPage"), "MyRequestsPage")

const ProfessionalOverviewPage = lazyPage(() => import("@/features/provider/ProfessionalOverviewPage"), "ProfessionalOverviewPage")
const ProfessionalListingsPage = lazyPage(() => import("@/features/provider/ProfessionalListingsPage"), "ProfessionalListingsPage")
const ProfessionalLeadsPage = lazyPage(() => import("@/features/provider/ProfessionalLeadsPage"), "ProfessionalLeadsPage")
const ProfessionalProfilePage = lazyPage(() => import("@/features/provider/ProfessionalProfilePage"), "ProfessionalProfilePage")
const ProfessionalAnalyticsPage = lazyPage(() => import("@/features/provider/ProfessionalAnalyticsPage"), "ProfessionalAnalyticsPage")
const UpgradePage = lazyPage(() => import("@/features/provider/UpgradePage"), "UpgradePage")
const ListingFormPage = lazyPage(() => import("@/features/provider/ListingFormPage"), "ListingFormPage")
const ListingPendingPage = lazyPage(() => import("@/features/provider/ListingPendingPage"), "ListingPendingPage")
const EditListingPage = lazyPage(() => import("@/features/provider/EditListingPage"), "EditListingPage")

const AdminLoginPage = lazyPage(() => import("@/features/admin/AdminLoginPage"), "AdminLoginPage")
const AdminDashboardPage = lazyPage(() => import("@/features/admin/AdminDashboardPage"), "AdminDashboardPage")
const ModerationQueuePage = lazyPage(() => import("@/features/admin/ModerationQueuePage"), "ModerationQueuePage")
const ContentListPage = lazyPage(() => import("@/features/admin/ContentListPage"), "ContentListPage")
const ContentFormPage = lazyPage(() => import("@/features/admin/ContentFormPage"), "ContentFormPage")

/**
 * Centralized route tree (Master Spec §15). Phase 1 wires navigation and the
 * three layout shells end to end; every screen besides Home is a stub until
 * its phase is implemented — routes are not renamed later, only filled in.
 */
export const router = createBrowserRouter([
  {
    element: <ConsumerLayout />,
    children: [
      { path: routes.home, element: <HomePage /> },
      { path: routes.search, element: <SearchPage /> },
      { path: routes.services, element: <ServicesPage /> },
      {
        path: routes.servicesConstruction,
        element: <ComingSoonPage title="Home & Construction Services" />,
      },
      { path: routes.providerProfile, element: <ProviderProfilePage /> },
      { path: routes.directory, element: <DirectoryPage /> },
      { path: routes.food, element: <FoodPage /> },
      { path: routes.businessProfile, element: <BusinessProfilePage /> },
      { path: routes.education, element: <EducationPage /> },
      { path: routes.tutorProfile, element: <TutorProfilePage /> },
      { path: routes.property, element: <PropertyPage /> },
      { path: routes.propertyDetails, element: <PropertyDetailsPage /> },
      { path: routes.news, element: <NewsListPage /> },
      { path: routes.newsArticle, element: <NewsArticlePage /> },
      { path: routes.login, element: <LoginRegisterPage /> },
      { path: routes.register, element: <LoginRegisterPage /> },
      { path: routes.profile, element: <ResidentOverviewPage /> },
      { path: routes.profileSaved, element: <SavedPage /> },
      { path: routes.profileRequests, element: <MyRequestsPage /> },
      { path: routes.comingSoon, element: <ComingSoonPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    path: routes.providerDashboard,
    element: <ProviderLayout />,
    children: [
      { index: true, element: <ProfessionalOverviewPage /> },
      { path: "listings", element: <ProfessionalListingsPage /> },
      { path: "listings/new", element: <ListingFormPage /> },
      { path: "listings/pending", element: <ListingPendingPage /> },
      { path: "listings/:id/edit", element: <EditListingPage /> },
      { path: "leads", element: <ProfessionalLeadsPage /> },
      { path: "profile", element: <ProfessionalProfilePage /> },
      { path: "analytics", element: <ProfessionalAnalyticsPage /> },
      { path: "upgrade", element: <UpgradePage /> },
    ],
  },
  {
    path: routes.adminDashboard,
    element: <AdminLayout />,
    children: [
      { index: true, element: <AdminDashboardPage /> },
      { path: "login", element: <AdminLoginPage /> },
      { path: "moderation", element: <ModerationQueuePage /> },
      { path: "content", element: <ContentListPage /> },
      { path: "content/new", element: <ContentFormPage /> },
      { path: "content/:id/edit", element: <ContentFormPage /> },
    ],
  },
])

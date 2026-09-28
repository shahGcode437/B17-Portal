import { createBrowserRouter } from "react-router-dom"
import { ConsumerLayout } from "@/app/ConsumerLayout"
import { ProviderLayout } from "@/app/ProviderLayout"
import { AdminLayout } from "@/app/AdminLayout"
import { HomePage } from "@/features/home/HomePage"
import { SearchPage } from "@/features/search/SearchPage"
import { ServicesPage } from "@/features/services/ServicesPage"
import { ProviderProfilePage } from "@/features/services/ProviderProfilePage"
import { DirectoryPage } from "@/features/directory/DirectoryPage"
import { BusinessProfilePage } from "@/features/directory/BusinessProfilePage"
import { EducationPage } from "@/features/education/EducationPage"
import { TutorProfilePage } from "@/features/education/TutorProfilePage"
import { PropertyPage } from "@/features/property/PropertyPage"
import { PropertyDetailsPage } from "@/features/property/PropertyDetailsPage"
import { NewsListPage } from "@/features/news/NewsListPage"
import { NewsArticlePage } from "@/features/news/NewsArticlePage"
import { LoginRegisterPage } from "@/features/auth/LoginRegisterPage"
import { ResidentOverviewPage } from "@/features/resident/ResidentOverviewPage"
import { SavedPage } from "@/features/resident/SavedPage"
import { MyRequestsPage } from "@/features/resident/MyRequestsPage"
import { ProviderDashboardPage } from "@/features/provider/ProviderDashboardPage"
import { ListingFormPage } from "@/features/provider/ListingFormPage"
import { ListingPendingPage } from "@/features/provider/ListingPendingPage"
import { AdminLoginPage } from "@/features/admin/AdminLoginPage"
import { AdminDashboardPage } from "@/features/admin/AdminDashboardPage"
import { ModerationQueuePage } from "@/features/admin/ModerationQueuePage"
import { ContentListPage } from "@/features/admin/ContentListPage"
import { ContentFormPage } from "@/features/admin/ContentFormPage"
import { ComingSoonPage } from "@/features/future-modules/ComingSoonPage"
import { NotFoundPage } from "@/features/future-modules/NotFoundPage"
import { routes } from "@/config/routes"

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
      { index: true, element: <ProviderDashboardPage /> },
      { path: "listings/new", element: <ListingFormPage /> },
      { path: "listings/pending", element: <ListingPendingPage /> },
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

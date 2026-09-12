import { createBrowserRouter } from "react-router-dom"
import { ConsumerLayout } from "@/app/ConsumerLayout"
import { ProviderLayout } from "@/app/ProviderLayout"
import { AdminLayout } from "@/app/AdminLayout"
import { HomePage } from "@/features/home/HomePage"
import { SearchPage } from "@/features/search/SearchPage"
import { ServicesPage } from "@/features/services/ServicesPage"
import { ProviderProfilePage } from "@/features/services/ProviderProfilePage"
import { LoginRegisterPage } from "@/features/auth/LoginRegisterPage"
import { ProviderDashboardPage } from "@/features/provider/ProviderDashboardPage"
import { ListingFormPage } from "@/features/provider/ListingFormPage"
import { ListingPendingPage } from "@/features/provider/ListingPendingPage"
import { AdminLoginPage } from "@/features/admin/AdminLoginPage"
import { AdminDashboardPage } from "@/features/admin/AdminDashboardPage"
import { ModerationQueuePage } from "@/features/admin/ModerationQueuePage"
import { ComingSoonPage } from "@/features/future-modules/ComingSoonPage"
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
      { path: routes.directory, element: <ComingSoonPage title="Business Directory" /> },
      { path: routes.education, element: <ComingSoonPage title="Education" /> },
      { path: routes.property, element: <ComingSoonPage title="Property" /> },
      { path: routes.news, element: <ComingSoonPage title="News & Daily Updates" /> },
      { path: routes.login, element: <LoginRegisterPage /> },
      { path: routes.register, element: <LoginRegisterPage /> },
      { path: routes.profile, element: <ComingSoonPage title="Profile" /> },
      { path: routes.comingSoon, element: <ComingSoonPage /> },
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
    ],
  },
  {
    path: "*",
    element: <ComingSoonPage title="Page Not Found" />,
  },
])

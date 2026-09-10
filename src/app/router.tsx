import { createBrowserRouter } from "react-router-dom"
import { ConsumerLayout } from "@/app/ConsumerLayout"
import { ProviderLayout } from "@/app/ProviderLayout"
import { AdminLayout } from "@/app/AdminLayout"
import { HomePage } from "@/features/home/HomePage"
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
      { path: routes.search, element: <ComingSoonPage title="Search / Explore" /> },
      { path: routes.services, element: <ComingSoonPage title="Services" /> },
      {
        path: routes.servicesConstruction,
        element: <ComingSoonPage title="Home & Construction Services" />,
      },
      { path: routes.directory, element: <ComingSoonPage title="Business Directory" /> },
      { path: routes.education, element: <ComingSoonPage title="Education" /> },
      { path: routes.property, element: <ComingSoonPage title="Property" /> },
      { path: routes.news, element: <ComingSoonPage title="News & Daily Updates" /> },
      { path: routes.login, element: <ComingSoonPage title="Login / Register" /> },
      { path: routes.register, element: <ComingSoonPage title="Login / Register" /> },
      { path: routes.profile, element: <ComingSoonPage title="Profile" /> },
      { path: routes.comingSoon, element: <ComingSoonPage /> },
    ],
  },
  {
    path: routes.providerDashboard,
    element: <ProviderLayout />,
    children: [
      { index: true, element: <ComingSoonPage title="Provider Dashboard" /> },
      { path: "listings/new", element: <ComingSoonPage title="Create Listing" /> },
      { path: "listings/pending", element: <ComingSoonPage title="Listing Pending" /> },
    ],
  },
  {
    path: routes.adminDashboard,
    element: <AdminLayout />,
    children: [
      { index: true, element: <ComingSoonPage title="Admin Dashboard" /> },
      { path: "login", element: <ComingSoonPage title="Admin Login" /> },
      { path: "moderation", element: <ComingSoonPage title="Listing Review" /> },
    ],
  },
  {
    path: "*",
    element: <ComingSoonPage title="Page Not Found" />,
  },
])

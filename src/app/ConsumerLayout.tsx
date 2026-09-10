import { Outlet } from "react-router-dom"
import { Header } from "@/components/navigation/Header"
import { Footer } from "@/components/navigation/Footer"
import { MobileNav } from "@/components/navigation/MobileNav"

/** Shell for all public/resident-facing screens (Home, Services, Directory, …). */
function ConsumerLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <MobileNav />
    </div>
  )
}

export { ConsumerLayout }

import { RouteOutlet } from "@/app/RouteOutlet"
import { Header } from "@/components/navigation/Header"
import { Footer } from "@/components/navigation/Footer"
import { SkipLink } from "@/components/navigation/SkipLink"
import { MobileNav } from "@/components/navigation/MobileNav"
import { InstallPrompt } from "@/components/pwa/InstallPrompt"

/** Shell for all public/resident-facing screens (Home, Services, Directory, …). */
function ConsumerLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SkipLink />
      <Header />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <RouteOutlet />
      </main>
      <InstallPrompt />
      <Footer />
      <MobileNav />
    </div>
  )
}

export { ConsumerLayout }

import { MotionConfig } from "motion/react"
import { RouterProvider } from "react-router-dom"
import { router } from "@/app/router"
import { ToastProvider } from "@/components/feedback/ToastProvider"
import { PwaStatus } from "@/components/pwa/PwaStatus"
import { AuthProvider } from "@/features/auth/AuthProvider"

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
          <PwaStatus />
        </AuthProvider>
      </ToastProvider>
    </MotionConfig>
  )
}

export default App

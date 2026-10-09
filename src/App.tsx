import { MotionConfig } from "motion/react"
import { RouterProvider } from "react-router-dom"
import { router } from "@/app/router"
import { ToastProvider } from "@/components/feedback/ToastProvider"
import { PwaStatus } from "@/components/pwa/PwaStatus"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { AdminAuthProvider } from "@/features/admin/AdminAuthProvider"

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AuthProvider>
          <AdminAuthProvider>
            <RouterProvider router={router} />
            <PwaStatus />
          </AdminAuthProvider>
        </AuthProvider>
      </ToastProvider>
    </MotionConfig>
  )
}

export default App

import { MotionConfig } from "motion/react"
import { RouterProvider } from "react-router-dom"
import { router } from "@/app/router"
import { ToastProvider } from "@/components/feedback/ToastProvider"
import { AuthProvider } from "@/features/auth/AuthProvider"

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </MotionConfig>
  )
}

export default App

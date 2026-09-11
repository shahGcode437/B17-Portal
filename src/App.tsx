import { MotionConfig } from "motion/react"
import { RouterProvider } from "react-router-dom"
import { router } from "@/app/router"
import { ToastProvider } from "@/components/feedback/ToastProvider"

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </MotionConfig>
  )
}

export default App

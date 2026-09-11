import * as React from "react"
import { AnimatePresence, motion } from "motion/react"
import { CheckCircle2 } from "lucide-react"
import { ToastContext } from "@/hooks/useToast"
import { duration } from "@/lib/motion"

interface ToastItem {
  id: string
  message: string
}

const AUTO_DISMISS_MS = 3200

/** Renders app-wide toast feedback for simulated demo actions. */
function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])

  const show = React.useCallback((message: string) => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, message }])
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id))
    }, AUTO_DISMISS_MS)
  }, [])

  const value = React.useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-toast flex flex-col items-center gap-2 px-4 md:bottom-6">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: duration.toast }}
              className="pointer-events-auto flex max-w-sm items-center gap-2 rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-elevated"
            >
              <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export { ToastProvider }

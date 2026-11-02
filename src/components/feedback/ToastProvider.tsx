import * as React from "react"
import { AnimatePresence, motion } from "motion/react"
import { CheckCircle2, TriangleAlert } from "lucide-react"
import { ToastContext, type ToastOptions } from "@/hooks/useToast"
import { duration } from "@/lib/motion"
import { cn } from "@/lib/utils"

interface ToastItem {
  id: string
  message: string
  tone: NonNullable<ToastOptions["tone"]>
}

const AUTO_DISMISS_MS = 3200

/** Renders app-wide toast feedback for simulated demo actions. */
function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])

  const show = React.useCallback((message: string, options?: ToastOptions) => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, message, tone: options?.tone ?? "success" }])
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
              role={toast.tone === "error" ? "alert" : "status"}
              aria-live={toast.tone === "error" ? "assertive" : "polite"}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: duration.toast }}
              className={cn(
                "pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium shadow-elevated ring-1 backdrop-blur-md",
                toast.tone === "error"
                  ? "bg-destructive/95 text-destructive-foreground ring-destructive/40"
                  : "bg-foreground/95 text-background ring-foreground/40"
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full",
                  toast.tone === "error" ? "bg-destructive-foreground/15" : "bg-primary/25"
                )}
                aria-hidden="true"
              >
                {toast.tone === "error" ? (
                  <TriangleAlert className="size-3.5" />
                ) : (
                  <CheckCircle2 className="size-3.5 text-primary-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1 leading-snug">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export { ToastProvider }

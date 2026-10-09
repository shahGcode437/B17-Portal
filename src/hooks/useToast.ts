import { createContext, useContext } from "react"

export interface ToastOptions {
  /** "error" is for a message that something did NOT happen (e.g. offline); it must not look like a success. */
  tone?: "success" | "error"
}

export interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

/** Lightweight toast for simulated actions (WhatsApp/Request stubs). */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return ctx
}

/**
 * Install-prompt state (Phase 9G). Frontend-only; stores nothing but one dismissal timestamp.
 *
 * Three install situations are kept distinct:
 *  - "native": the browser fired `beforeinstallprompt` (Chromium); we keep the event and
 *    offer an "Install" button that triggers the real browser prompt. We never fake it.
 *  - "ios": iOS/iPadOS has no install prompt API, so we only show how to use
 *    Share -> Add to Home Screen.
 *  - "none": already installed / running standalone, dismissed recently, or an
 *    environment with no install path (e.g. desktop Firefox) — nothing is shown.
 * The listener is attached at startup (`initInstallCapture`) because the browser can fire
 * `beforeinstallprompt` before React mounts.
 */
export type InstallMode = "native" | "ios" | "none"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const DISMISS_KEY = "b17.pwa.installDismissedAt"
/** A dismissed suggestion stays away for 30 days. */
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = false
let mode: InstallMode = "none"
const listeners = new Set<() => void>()

function readDismissedAt(): number {
  try {
    return Number(window.localStorage.getItem(DISMISS_KEY)) || 0
  } catch {
    return 0
  }
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as a Mac; a touch screen tells them apart.
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

function compute(): InstallMode {
  if (installed || isStandalone()) return "none"
  if (Date.now() - readDismissedAt() < DISMISS_MS) return "none"
  if (deferredPrompt) return "native"
  if (isIos()) return "ios"
  return "none"
}

function emit() {
  mode = compute()
  listeners.forEach((listener) => listener())
}

export function initInstallCapture() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener("appinstalled", () => {
    installed = true
    deferredPrompt = null
    emit()
  })
  window.matchMedia("(display-mode: standalone)").addEventListener("change", emit)
  emit()
}

export function subscribeInstall(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getInstallMode(): InstallMode {
  return mode
}

export function dismissInstall() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    // Private mode / blocked storage: the suggestion just comes back next visit.
  }
  emit()
}

/** Shows the browser's own install dialog. A prompt can be used once; a dismissal is remembered. */
export async function promptInstall() {
  const event = deferredPrompt
  if (!event) return
  deferredPrompt = null
  await event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === "dismissed") dismissInstall()
  else emit()
}

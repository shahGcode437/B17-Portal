import { useSyncExternalStore } from "react"
import { getInstallMode, subscribeInstall } from "@/pwa/install"
import { getUpdateAvailable, subscribeUpdate } from "@/pwa/serviceWorker"

/** Which install affordance (if any) applies right now — see `src/pwa/install.ts`. */
export function useInstallMode() {
  return useSyncExternalStore(subscribeInstall, getInstallMode)
}

/** True once a newer service worker is installed and waiting for the user to refresh. */
export function useUpdateAvailable() {
  return useSyncExternalStore(subscribeUpdate, getUpdateAvailable)
}

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener)
  window.addEventListener("offline", listener)
  return () => {
    window.removeEventListener("online", listener)
    window.removeEventListener("offline", listener)
  }
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine)
}

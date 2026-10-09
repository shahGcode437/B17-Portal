/**
 * Service worker registration and the "update available" state (Phase 9G).
 * Production builds only — in `vite dev` no worker is registered, so development
 * never serves cached modules. Registration failure is silent: the plain website
 * keeps working exactly as before.
 *
 * Update strategy: a new worker installs in the background and WAITS. We only
 * surface "update available"; the worker takes over (SKIP_WAITING) and the page
 * reloads once, and only when the user asks (`applyUpdate`). Nothing reloads by
 * itself, and `updateRequested` makes the single reload impossible to loop.
 */
let waitingWorker: ServiceWorker | null = null
let updateRequested = false
const listeners = new Set<() => void>()

function setWaiting(worker: ServiceWorker) {
  waitingWorker = worker
  listeners.forEach((listener) => listener())
}

export function subscribeUpdate(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getUpdateAvailable(): boolean {
  return waitingWorker !== null
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateRequested) window.location.reload()
  })

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // A worker only counts as an *update* when an older one already controls this page.
        const track = (worker: ServiceWorker) => {
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker)
          })
        }
        if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting)
        registration.addEventListener("updatefound", () => {
          if (registration.installing) track(registration.installing)
        })
      })
      .catch(() => {})
  })
}

/** Asks the waiting worker to take over; the page reloads once when it does. Returns false if nothing is waiting. */
export function applyUpdate(): boolean {
  if (!waitingWorker) return false
  updateRequested = true
  waitingWorker.postMessage({ type: "SKIP_WAITING" })
  return true
}

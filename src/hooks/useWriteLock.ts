import { useCallback, useSyncExternalStore } from "react"

/**
 * One staff or administrative change per key at a time, for the whole tab. A screen that is left and
 * reopened while its request is still on the way must not offer to send another (some changes carry
 * no version, so the server alone would accept them twice). Memory only: ids and fixed names, never
 * record data.
 */
const busy = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** `false` when a change for this key is already on its way. */
export function acquireWrite(key: string): boolean {
  if (busy.has(key)) return false
  busy.add(key)
  emit()
  return true
}

export function releaseWrite(key: string): void {
  if (busy.delete(key)) emit()
}

export function useWriteInFlight(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => busy.has(key), [key])
  )
}

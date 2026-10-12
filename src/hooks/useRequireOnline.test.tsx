import type { ReactNode } from "react"
import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OFFLINE_MUTATION_MESSAGE, useRequireOnline } from "@/hooks/useRequireOnline"
import { ToastContext } from "@/hooks/useToast"

function setup() {
  const show = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => <ToastContext.Provider value={{ show }}>{children}</ToastContext.Provider>
  const { result } = renderHook(() => useRequireOnline(), { wrapper })
  return { show, requireOnline: result.current }
}

const setOnline = (value: boolean) => vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value)

afterEach(() => vi.restoreAllMocks())

describe("useRequireOnline (offline mutation safety)", () => {
  it("lets a state-changing action proceed online and says nothing", () => {
    setOnline(true)
    const { requireOnline, show } = setup()
    expect(requireOnline()).toBe(true)
    expect(show).not.toHaveBeenCalled()
  })

  it("blocks the action offline and reports it with an ERROR-tone message (never a success toast)", () => {
    setOnline(false)
    const { requireOnline, show } = setup()
    expect(requireOnline()).toBe(false)
    expect(show).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledWith("You're offline. Reconnect to make changes.", { tone: "error" })
    expect(OFFLINE_MUTATION_MESSAGE).toBe("You're offline. Reconnect to make changes.")
  })

  it("reads connectivity at call time, so reconnecting restores normal behavior", () => {
    const spy = setOnline(false)
    const { requireOnline } = setup()
    expect(requireOnline()).toBe(false)
    spy.mockReturnValue(true)
    expect(requireOnline()).toBe(true)
  })
})

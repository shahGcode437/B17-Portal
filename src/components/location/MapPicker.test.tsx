import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MapPicker } from "@/components/location/MapPicker"
import type { PickerEngine, PickerOptions } from "@/components/location/leafletPickerEngine"
import { APPROXIMATE_CIRCLE_RADIUS_METERS } from "@/config/map"

/** A fake picker engine: records what it is asked to draw. No Leaflet, no canvas, no tile request. */
function fakePicker() {
  const mounts: PickerOptions[] = []
  const destroy = vi.fn()
  const engine: PickerEngine = {
    mount: (_element, options) => {
      mounts.push(options)
      return { destroy }
    },
  }
  return { engine, mounts, destroy, latest: () => mounts[mounts.length - 1]! }
}

describe("MapPicker (writable map)", () => {
  it("with no point yet: centres on B-17, draws no pin, nothing is draggable", async () => {
    const { engine, mounts, latest } = fakePicker()
    render(<MapPicker mode="exact" value={null} onChange={() => {}} label="Shop" engine={engine} />)
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
    expect(latest().marker).toBeUndefined()
    expect(latest().circle).toBeUndefined()
    expect(latest().draggable).toBe(false)
    expect(latest().center).toEqual({ latitude: 33.7, longitude: 73.05 })
  })

  it("a click on the map (onPick) reports the clicked point", async () => {
    const onChange = vi.fn()
    const { engine, mounts, latest } = fakePicker()
    render(<MapPicker mode="exact" value={null} onChange={onChange} label="Shop" engine={engine} />)
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
    latest().onPick?.({ latitude: 33.7123, longitude: 73.0456 })
    expect(onChange).toHaveBeenCalledWith({ latitude: 33.7123, longitude: 73.0456 })
  })

  it("with a point: draws a labelled draggable pin; dragging it (onPick) reports the new point", async () => {
    const onChange = vi.fn()
    const { engine, mounts, latest } = fakePicker()
    render(<MapPicker mode="exact" value={{ latitude: 33.7, longitude: 73.05 }} onChange={onChange} label="Shop" engine={engine} />)
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
    expect(latest().marker).toEqual({ position: { latitude: 33.7, longitude: 73.05 }, label: "Shop location" })
    expect(latest().draggable).toBe(true)
    expect(latest().circle).toBeUndefined() // exact = the pin alone
    latest().onPick?.({ latitude: 33.705, longitude: 73.055 })
    expect(onChange).toHaveBeenCalledWith({ latitude: 33.705, longitude: 73.055 })
  })

  it("approximate mode adds the illustrative circle around the pin", async () => {
    const { engine, mounts, latest } = fakePicker()
    render(<MapPicker mode="approximate" value={{ latitude: 33.71, longitude: 73.06 }} onChange={() => {}} label="Plot" engine={engine} />)
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
    expect(latest().circle).toEqual({ center: { latitude: 33.71, longitude: 73.06 }, radiusMeters: APPROXIMATE_CIRCLE_RADIUS_METERS })
  })

  it("destroys the map on unmount, and says so (not blank) when the engine fails", async () => {
    const { engine, mounts, destroy } = fakePicker()
    const { unmount } = render(<MapPicker mode="exact" value={null} onChange={() => {}} label="Shop" engine={engine} />)
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
    unmount()
    expect(destroy).toHaveBeenCalled()

    const broken: PickerEngine = {
      mount: () => {
        throw new Error("no canvas")
      },
    }
    render(<MapPicker mode="exact" value={null} onChange={() => {}} label="Shop" engine={broken} />)
    expect(await screen.findByRole("status")).toHaveTextContent(/enter numeric coordinates/i)
  })
})

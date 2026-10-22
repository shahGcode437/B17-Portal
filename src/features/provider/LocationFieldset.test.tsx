import { useEffect, useState } from "react"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LocationFieldset } from "@/features/provider/LocationFieldset"
import type { PickerOptions } from "@/components/location/leafletPickerEngine"
import type { LocationWrite } from "@/lib/api/writes/listings"

// The lazy-loaded Leaflet picker engine is replaced by a recorder: no Leaflet, canvas or OSM tile request.
const mounts: PickerOptions[] = []
vi.mock("@/components/location/leafletPickerEngine", () => ({
  leafletPickerEngine: {
    mount: (_element: HTMLElement, options: PickerOptions) => {
      mounts.push(options)
      return { destroy: () => {} }
    },
  },
}))

const ALL = ["exact", "approximate", "area_only"] as const
const PROPERTY = ["exact", "approximate"] as const

let latest: LocationWrite
function Harness({ initial, allowed = ALL }: { initial: LocationWrite; allowed?: ReadonlyArray<"exact" | "approximate" | "area_only"> }) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    latest = value
  })
  return <LocationFieldset value={value} onChange={setValue} itemLabel="Demo Shop" allowedVisibilities={allowed} />
}
const lastOptions = () => mounts[mounts.length - 1]!

let fetchSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  mounts.length = 0
  fetchSpy = vi.spyOn(globalThis, "fetch")
})
afterEach(() => fetchSpy.mockRestore())

describe("LocationFieldset (the writable location block)", () => {
  it("a map click sets the point: value and the numeric boxes update (rounded to 6 dp)", async () => {
    render(<Harness initial={{ visibility: "exact" }} />)
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
    lastOptions().onPick?.({ latitude: 33.70123456789, longitude: 73.05123456789 })
    await waitFor(() => expect(latest.latitude).toBe(33.701235))
    expect(latest.longitude).toBe(73.051235)
    expect(screen.getByLabelText("Latitude")).toHaveValue("33.701235")
    expect(screen.getByLabelText("Longitude")).toHaveValue("73.051235")
  })

  it("a dragged pin reports through the same path, and the pin is draggable once a point exists", async () => {
    render(<Harness initial={{ visibility: "exact", latitude: 33.7, longitude: 73.05 }} />)
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
    expect(lastOptions().draggable).toBe(true)
    lastOptions().onPick?.({ latitude: 33.71, longitude: 73.06 })
    await waitFor(() => expect(latest).toMatchObject({ latitude: 33.71, longitude: 73.06 }))
  })

  it("numeric fallback: typed coordinates commit on blur; an out-of-range pair does not", async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ visibility: "exact" }} />)
    await user.type(screen.getByLabelText("Latitude"), "33.7012")
    await user.type(screen.getByLabelText("Longitude"), "73.0512")
    await user.tab()
    expect(latest).toMatchObject({ latitude: 33.7012, longitude: 73.0512 })

    await user.clear(screen.getByLabelText("Latitude"))
    await user.type(screen.getByLabelText("Latitude"), "123.4")
    await user.tab()
    expect(latest.latitude).toBe(33.7012) // 123.4 is not a latitude: not committed
  })

  it("area_only clears the point, the address and the landmark and keeps only the block; no map is shown", async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ visibility: "exact", block: "C", address: "Shop 4", landmark: "Park", latitude: 33.7, longitude: 73.05 }} />)
    await waitFor(() => expect(screen.getByTestId("map-picker")).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText("Visibility"), "area_only")
    expect(latest).toEqual({ visibility: "area_only", block: "C" })
    expect(screen.queryByTestId("map-picker")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Latitude")).not.toBeInTheDocument()
    expect(screen.getByText(/Location shared at area level/)).toBeInTheDocument()
    // Going back to a located kind starts with no stale point.
    await user.selectOptions(screen.getByLabelText("Visibility"), "approximate")
    expect(latest.latitude).toBeUndefined()
    expect(screen.getByLabelText("Latitude")).toHaveValue("")
  })

  it("exact to approximate keeps the point but drops the address and landmark (the backend forbids them)", async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ visibility: "exact", block: "C", address: "Shop 4", landmark: "Park", latitude: 33.7, longitude: 73.05 }} />)
    await user.selectOptions(screen.getByLabelText("Visibility"), "approximate")
    expect(latest).toEqual({ visibility: "approximate", block: "C", latitude: 33.7, longitude: 73.05 })
    expect(screen.queryByLabelText("Street address")).not.toBeInTheDocument()
  })

  it("a Property form cannot choose area_only (the option is not offered)", () => {
    render(<Harness initial={{ visibility: "exact" }} allowed={PROPERTY} />)
    const options = within(screen.getByLabelText("Visibility")).getAllByRole("option").map((o) => o.getAttribute("value"))
    expect(options).toEqual(["exact", "approximate"])
  })

  it("never calls the network (no OSM tile or geocoder request from the picker or the fallback)", async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ visibility: "exact" }} />)
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
    lastOptions().onPick?.({ latitude: 33.7, longitude: 73.05 })
    await user.type(screen.getByLabelText("Block (optional)"), "C")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

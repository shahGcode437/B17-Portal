import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MapPicker } from "@/components/location/MapPicker"
import type { PickerEngine, PickerOptions } from "@/components/location/leafletPickerEngine"
import { APPROXIMATE_CIRCLE_RADIUS_METERS, B17_DEFAULT_CENTER } from "@/config/map"
import { buildDirectionsUrl } from "@/components/location/directions"

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
    // The empty-picker centre comes from the shared `B17_DEFAULT_CENTER` config constant (Multi
    // Gardens B-17, ~72.8x longitude). Pinning it to the constant means the test follows any future
    // `VITE_MAP_DEFAULT_CENTER` override instead of hard-coding the current numbers.
    expect(latest().center).toEqual(B17_DEFAULT_CENTER)
  })

  /**
   * Regression for the manual-QA bug where the picker's hardcoded `{ latitude: 33.7, longitude: 73.05 }`
   * default sat around Islamabad / E-11; the owner clicked on the visibly-plausible map thinking it was
   * B-17 and the stored point ended up in the wrong sector. The default centre must now put a visible
   * click in the real Multi Gardens B-17 longitude range (~72.8x), and it must not ship as the old
   * ~73.05 anywhere in production code.
   */
  describe("default centre is the real B-17 sector, not Islamabad / E-11", () => {
    it("`B17_DEFAULT_CENTER` lives in the Multi Gardens B-17 sector (longitude ~72.8x, latitude ~33.68x)", () => {
      // The three publicly-referenced points inside B-17 used to pick the centre:
      // (33.680967, 72.819052), (33.686377, 72.831271), (33.687759, 72.829501).
      expect(B17_DEFAULT_CENTER.longitude).toBeGreaterThan(72.8)
      expect(B17_DEFAULT_CENTER.longitude).toBeLessThan(72.9)
      expect(B17_DEFAULT_CENTER.latitude).toBeGreaterThan(33.67)
      expect(B17_DEFAULT_CENTER.latitude).toBeLessThan(33.7)
    })

    it("a first map click in the displayed B-17 area reports a point in the 72.8x longitude range (not the old 73.05)", async () => {
      // Simulate: the picker opens empty, so it centres on `B17_DEFAULT_CENTER`. The owner clicks near
      // that centre (they see Multi Gardens B-17 in the viewport). The engine reports the clicked
      // point through `onPick`; the map does not invent coordinates, so a click near the new centre
      // reports a real B-17 point around longitude 72.8x — never 73.05.
      const onChange = vi.fn<(point: { latitude: number; longitude: number }) => void>()
      const { engine, mounts, latest } = fakePicker()
      render(<MapPicker mode="exact" value={null} onChange={onChange} label="Shop" engine={engine} />)
      await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
      // Simulate a tiny click near the default centre (what the real engine would deliver).
      const nearCentre = {
        latitude: B17_DEFAULT_CENTER.latitude + 0.0004,
        longitude: B17_DEFAULT_CENTER.longitude + 0.0004,
      }
      latest().onPick?.(nearCentre)
      expect(onChange).toHaveBeenCalledWith(nearCentre)
      expect(onChange.mock.calls[0][0].longitude).toBeGreaterThan(72.8)
      expect(onChange.mock.calls[0][0].longitude).toBeLessThan(72.9)
    })

    it("Get Directions preserves the stored point verbatim (nothing is re-centred, no fallback to 73.05 is ever used)", () => {
      // The destination parameter is built from the stored point's own numbers, not from the picker
      // default; changing the picker centre must never change where Get Directions sends the user.
      const stored = { latitude: 33.687759, longitude: 72.829501 }
      const url = buildDirectionsUrl(stored)
      expect(url).toContain("destination=33.687759%2C72.829501")
      expect(url).not.toContain("73.05")
    })

    it("no production source still ships the old B-17 centre longitude 73.05", async () => {
      // A repo-wide scan: every `.ts` / `.tsx` file under `src/`, excluding tests, type-only fixtures
      // and this file's own forbidden literal in comments / doc-prose. If a NEW production default ever
      // reintroduces 73.05 as a B-17 centre, this test fails with the offending file path.
      const modules = import.meta.glob<string>("/src/**/*.{ts,tsx}", {
        query: "?raw",
        import: "default",
        eager: true,
      })
      const offenders: string[] = []
      for (const [path, source] of Object.entries(modules)) {
        if (/\.test\.(ts|tsx)$/.test(path)) continue // tests may still use 73.05 as a generic valid-coord example
        if (path.startsWith("/src/test/")) continue // frontend mock fixtures are contract-only, not geography
        // Strip comments so an honest explanatory doc-comment about the old 73.05 does not trip the scan.
        const stripped = source
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
        // Catch a longitude literal that starts with 73.05 and isn't followed by more digits that push
        // it outside B-17 territory — "73.05", "73.051234", "73.0512" etc. — but NOT a benign hit like
        // "x73.05y" or a template literal with 73.050 somewhere unrelated.
        if (/\b73\.05\d*\b/.test(stripped)) offenders.push(path)
      }
      expect(offenders).toEqual([])
    })
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

  it("a parent that re-renders with a NEW onChange does not re-mount the map (the owner's pan and zoom survive typing)", async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { engine, mounts, destroy } = fakePicker()
    const point = { latitude: 33.7, longitude: 73.05 }
    const { rerender } = render(<MapPicker mode="exact" value={point} onChange={first} label="Shop" engine={engine} />)
    await waitFor(() => expect(mounts).toHaveLength(1))

    // The form re-renders on every keystroke, handing down a fresh handler and an equal-valued point object.
    rerender(<MapPicker mode="exact" value={{ ...point }} onChange={second} label="Shop" engine={engine} />)
    rerender(<MapPicker mode="exact" value={{ ...point }} onChange={vi.fn(second)} label="Shop" engine={engine} />)
    expect(mounts).toHaveLength(1)
    expect(destroy).not.toHaveBeenCalled()

    // The engine still reports to the CURRENT handler, never a stale one.
    mounts[0].onPick?.({ latitude: 33.71, longitude: 73.06 })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({ latitude: 33.71, longitude: 73.06 })
  })

  it("a changed point or mode still redraws the map", async () => {
    const { engine, mounts } = fakePicker()
    const { rerender } = render(<MapPicker mode="exact" value={{ latitude: 33.7, longitude: 73.05 }} onChange={() => {}} label="Shop" engine={engine} />)
    await waitFor(() => expect(mounts).toHaveLength(1))
    rerender(<MapPicker mode="exact" value={{ latitude: 33.71, longitude: 73.06 }} onChange={() => {}} label="Shop" engine={engine} />)
    await waitFor(() => expect(mounts).toHaveLength(2))
    rerender(<MapPicker mode="approximate" value={{ latitude: 33.71, longitude: 73.06 }} onChange={() => {}} label="Shop" engine={engine} />)
    await waitFor(() => expect(mounts).toHaveLength(3))
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

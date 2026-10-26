import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Link, RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppRoot } from "@/app/ScrollManager"
import { scrollIntentFor } from "@/app/scrollIntent"
import { Footer } from "@/components/navigation/Footer"
import { Header } from "@/components/navigation/Header"
import { AuthContext } from "@/hooks/useAuth"
import { authContextValue } from "@/test/authFixtures"

const at = (pathname: string, extra: { key?: string; search?: string; hash?: string } = {}) => ({
  key: extra.key ?? pathname + (extra.search ?? "") + (extra.hash ?? ""),
  pathname,
  search: extra.search ?? "",
  hash: extra.hash ?? "",
})

describe("scrollIntentFor: the one scroll rule", () => {
  it("a different pathname is a new page: top (the footer-link bug)", () => {
    expect(scrollIntentFor(at("/"), at("/education"), "PUSH", false)).toBe("top")
    expect(scrollIntentFor(at("/businesses/1"), at("/businesses/2"), "PUSH", false)).toBe("top") // same route, other record
    expect(scrollIntentFor(at("/profile"), at("/login", { key: "r" }), "REPLACE", false)).toBe("top") // a redirect is a new page too
  })

  it("Back and Forward, and the first render, are left to the browser", () => {
    expect(scrollIntentFor(at("/education"), at("/", { key: "back" }), "POP", false)).toBe("keep")
    expect(scrollIntentFor(null, at("/"), "POP", false)).toBe("keep")
    expect(scrollIntentFor(at("/"), at("/"), "REPLACE", false)).toBe("keep") // same key: a Strict Mode re-run
  })

  it("a link to the same page with another query is a new page; an in-place filter edit is not", () => {
    expect(scrollIntentFor(at("/search", { search: "?q=a" }), at("/search", { search: "?type=provider", key: "b" }), "PUSH", false)).toBe("top")
    expect(scrollIntentFor(at("/search", { search: "?q=a" }), at("/search", { search: "?q=ab", key: "b" }), "REPLACE", false)).toBe("keep")
  })

  it("the very same URL again glides to the top (a click on the logo while on that page)", () => {
    expect(scrollIntentFor(at("/"), at("/", { key: "again" }), "REPLACE", false)).toBe("top-smooth")
    expect(scrollIntentFor(at("/search", { search: "?q=a" }), at("/search", { search: "?q=a", key: "again" }), "REPLACE", false)).toBe("top-smooth")
  })

  it("a fragment that names an element scrolls to it; one that names nothing falls back to the normal rule", () => {
    expect(scrollIntentFor(at("/faq"), at("/faq", { hash: "#a", key: "b" }), "PUSH", true)).toBe("hash")
    expect(scrollIntentFor(at("/"), at("/faq", { hash: "#missing", key: "b" }), "PUSH", false)).toBe("top")
  })
})

function page(label: string) {
  return (
    <main>
      <h1>{label}</h1>
      <Link to="/search?type=provider">to providers</Link>
    </main>
  )
}

function renderRouter(initial = "/") {
  const router = createMemoryRouter(
    [
      {
        element: <AppRoot />,
        children: [
          { path: "/", element: page("Home") },
          { path: "/education", element: page("Education") },
          { path: "/search", element: page("Search") },
          { path: "/faq", element: <main><h1>FAQ</h1><section id="billing">billing</section></main> },
        ],
      },
    ],
    { initialEntries: [initial] }
  )
  render(<RouterProvider router={router} />)
  return router
}

describe("ScrollManager in a router", () => {
  let scrollTo: ReturnType<typeof vi.fn>
  beforeEach(() => {
    scrollTo = vi.fn()
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  })
  afterEach(() => {
    window.scrollTo = () => {}
  })

  it("does not scroll on the first render", () => {
    renderRouter("/education")
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it("a navigation to another page starts at the top, whichever link caused it", async () => {
    const router = renderRouter("/")
    await act(() => router.navigate("/education"))
    expect(screen.getByRole("heading", { name: "Education" })).toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it("Back does not reset the position (the browser keeps the old one)", async () => {
    const router = renderRouter("/")
    await act(() => router.navigate("/education"))
    scrollTo.mockClear()
    await act(() => router.navigate(-1))
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it("an in-place query edit (replace) keeps the reader's place; a link to another query on the page goes to the top", async () => {
    const router = renderRouter("/search?q=a")
    await act(() => router.navigate("/search?q=ab", { replace: true }))
    expect(scrollTo).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole("link", { name: "to providers" }))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it("a fragment link scrolls to the element and a missing fragment target goes to the top", async () => {
    const intoView = vi.fn()
    Element.prototype.scrollIntoView = intoView
    const router = renderRouter("/")
    await act(() => router.navigate("/faq#billing"))
    expect(intoView).toHaveBeenCalledTimes(1)
    expect(scrollTo).not.toHaveBeenCalled()
    await act(() => router.navigate("/education#nope"))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    Element.prototype.scrollIntoView = () => {}
  })
})

describe("Bug A: the pin logo in the header and the footer", () => {
  let scrollTo: ReturnType<typeof vi.fn>
  beforeEach(() => {
    scrollTo = vi.fn()
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  })
  afterEach(() => {
    window.scrollTo = () => {}
  })

  function renderChrome(initial: string) {
    const router = createMemoryRouter(
      [
        {
          element: <AppRoot />,
          children: [
            {
              path: "*",
              element: (
                <AuthContext.Provider value={authContextValue({ user: null })}>
                  <Header />
                  <Footer />
                </AuthContext.Provider>
              ),
            },
          ],
        },
      ],
      { initialEntries: [initial] }
    )
    render(<RouterProvider router={router} />)
    return router
  }

  it.each([
    ["header", () => screen.getAllByRole("link", { name: "B-17 Portal home" })[0]],
    ["footer", () => screen.getAllByRole("link", { name: "B-17 Portal home" })[1]],
  ])("the %s logo, clicked on the home page, scrolls up instead of doing nothing", async (_where, logo) => {
    renderChrome("/")
    await userEvent.setup().click(logo())
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "smooth" })
  })

  it.each([
    ["header", 0],
    ["footer", 1],
  ])("the %s logo, clicked on another page, goes Home and starts at the top", async (_where, index) => {
    const router = renderChrome("/education")
    await userEvent.setup().click(screen.getAllByRole("link", { name: "B-17 Portal home" })[index])
    expect(router.state.location.pathname).toBe("/")
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it("honours reduced motion for the same-page glide", async () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      renderChrome("/")
      await userEvent.setup().click(screen.getAllByRole("link", { name: "B-17 Portal home" })[0])
      expect(scrollTo).toHaveBeenCalledWith(0, 0)
    } finally {
      window.matchMedia = original
    }
  })
})

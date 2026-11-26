import { describe, expect, it } from "vitest"
import { loopbackSignInAddress } from "@/lib/navigation"

/** The authorization URL the backend returns, with its registered callback in `redirect_uri`. */
const provider = (callbackOrigin: string) =>
  `https://accounts.google.com/o/oauth2/v2/auth?state=s&redirect_uri=${encodeURIComponent(`${callbackOrigin}/api/v1/auth/oauth/google/callback`)}`

describe("loopbackSignInAddress (a Google round trip that cannot finish is caught before it starts)", () => {
  it("sends a page opened at localhost to the callback's host, keeping its port and path", () => {
    expect(loopbackSignInAddress(provider("http://127.0.0.1:8000"), "/api/v1", "http://localhost:5173/login")).toBe(
      "http://127.0.0.1:5173/login"
    )
    expect(loopbackSignInAddress(provider("http://127.0.0.1:8000"), "/api/v1", "http://localhost:5173/register?x=1#y")).toBe(
      "http://127.0.0.1:5173/register"
    )
  })

  it("works the other way round when the callback is registered on localhost", () => {
    expect(loopbackSignInAddress(provider("http://localhost:8000"), "/api/v1", "http://127.0.0.1:5173/login")).toBe(
      "http://localhost:5173/login"
    )
  })

  it("lets the documented local topology through (a port is not part of a cookie's scope)", () => {
    expect(loopbackSignInAddress(provider("http://127.0.0.1:8000"), "/api/v1", "http://127.0.0.1:5173/login")).toBeNull()
  })

  it.each([
    ["split production", "https://api.b17portal.com", "https://api.b17portal.com/api/v1", "https://b17portal.com/login"],
    ["same-origin production", "https://b17portal.com", "/api/v1", "https://b17portal.com/login"],
    ["a deployed mismatch, which is not this check's business", "https://api.b17portal.com", "/api/v1", "https://b17portal.com/login"],
    ["only one side loopback", "https://api.b17portal.com", "/api/v1", "http://localhost:5173/login"],
  ])("never interferes with %s", (_label, callbackOrigin, apiBase, page) => {
    expect(loopbackSignInAddress(provider(callbackOrigin), apiBase, page)).toBeNull()
  })

  it("stays out of the way when the URL has no redirect_uri or is not a URL", () => {
    expect(loopbackSignInAddress("https://accounts.example.test/auth?state=s", "/api/v1", "http://localhost:5173/login")).toBeNull()
    expect(loopbackSignInAddress("not a url", "/api/v1", "http://localhost:5173/login")).toBeNull()
  })
})

/**
 * Backend API base URL. Configuration, not code.
 *
 * The browser ALWAYS talks to its own origin: `/api/v1/...`.
 *
 *  - Development: `vite` proxies `/api` to the FastAPI server (see `vite.config.ts`), so the page and
 *    the API share one origin whether you open `http://localhost:5173` or `http://127.0.0.1:5173`.
 *    The session cookie is host-only on that origin and `Sec-Fetch-Site` is `same-origin`, so the
 *    backend's Origin / CSRF checks (docs/backend/AUTH_RBAC.md §6) pass without any loosening.
 *    (A browser origin of `localhost` talking straight to `127.0.0.1:8000` is cross-site and is
 *    refused with `csrf_failed` - that is exactly what this default avoids.)
 *  - Production: the same relative path, with the API reverse-proxied next to the frontend.
 *  - `VITE_API_BASE_URL` still wins when set (no trailing slash, e.g. `https://api.example.org/api/v1`)
 *    for a deployment that really serves the API from another origin.
 */
const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, "")

export const API_BASE_URL: string = configured || "/api/v1"

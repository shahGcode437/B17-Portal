/**
 * Backend API base URL (Phase 12C). Configuration, not code.
 *
 *  - `VITE_API_BASE_URL` wins when set (no trailing slash, e.g. `https://api.example.org/api/v1`).
 *  - Development default: `http://127.0.0.1:8000/api/v1`. The frozen development topology uses
 *    `127.0.0.1` for BOTH the frontend (`:5173`) and the API (`:8000`) — never mix in `localhost`,
 *    or the session cookie would not be sent (docs/backend/AUTH_RBAC.md §5.1).
 *  - Production default: same-origin `/api/v1` (the API reverse-proxied next to the frontend).
 */
const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, "")

export const API_BASE_URL: string =
  configured || (import.meta.env.DEV ? "http://127.0.0.1:8000/api/v1" : "/api/v1")

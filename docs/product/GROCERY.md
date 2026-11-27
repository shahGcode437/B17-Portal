# Grocery by request — the customer frontend (GROCERY-3A)

**Built:** the customer's side only. **Not built:** the staff screens, the Super Admin's Grocery settings screens and staff appointment (the backend APIs for them exist, `docs/backend/API_CONTRACT.md` §18.6 and §19; nothing in the frontend calls them). **Grocery is disabled by default with no serviceable block, and is not production-ready** (`docs/backend/DEPLOYMENT.md` §15–§17).

## The service, as the app describes it

The customer sends a list → the team agrees the price **by phone** → buys from local shops → delivers → **cash on delivery**. No catalogue, cart, inventory, price in the app, online payment or live tracking.

## Routes

| Route | Screen | Who |
|---|---|---|
| `/grocery` | landing: availability, how it works, hours, areas, payment | anyone |
| `/grocery/new` | step 1, the list | anyone may write one |
| `/grocery/new/delivery` | step 2, delivery details | signed in (asked here) |
| `/grocery/new/review` | step 3, check and send | signed in; sending needs a verified e-mail |
| `/profile/grocery` | My Grocery Orders | signed in (`AuthGate`) |
| `/profile/grocery/:orderId` | order details | signed in; the owner |
| `/profile/grocery/:orderId/submitted` | "Order sent" | signed in; the owner |

Ways in: the header and footer, a banner on Home, the account tabs ("Grocery Orders") and a card on the account overview. The five-item mobile bottom bar is unchanged. `/grocery` is `noindex, follow` and absent from the sitemap while ordering is off by default; the rest are private.

## Where the code is

```
src/lib/api/dto/grocery.ts       the customer wire shapes (no staff field exists in them)
src/lib/api/reads/grocery.ts     availability, my orders, one order
src/lib/api/writes/grocery.ts    submit (with Idempotency-Key), cancel (with revision)
src/features/grocery/            screens, and the pure rules:
  quantity.ts       exact quantities        orderRequest.ts   the request body and form rules
  format.ts         money, days, times      orderStatus.ts    the status timeline
  groceryDraftStore.ts   the order being written, and its submission (memory only)
  GroceryDraftSession.tsx  mounted once beside the router: ties the draft to the account
src/test/fixtures/groceryBackend.ts   the contract as an in-memory object (tests only)
```

It reuses the existing API client (cookie, CSRF, session loss), `useRead` / `usePagedRead` / `useMutation`, `AuthGate`, `ResidentNav`, `PageHeader`, `StatusBadge`, `EmptyState` / `ReadError`, `FormAlert` / `FieldError`, the central error copy (`lib/api/writeErrors.ts`) and the phone rules (`lib/phone.ts`). The one change to shared infrastructure: the API client accepts extra request headers (for `Idempotency-Key`). **No new dependency; no backend change.**

## API integration

| Call | Used by | Notes |
|---|---|---|
| `GET /grocery/availability` | landing, list, delivery, review | the **only** source of whether ordering works, hours, blocks, units, limits and substitution choices |
| `POST /grocery/orders` | review | body exactly as declared; quantities are strings; phone sent as `+92…` |
| `GET /grocery/orders` `?status&limit&offset` | My Grocery Orders | 10 per page, "Load More" |
| `GET /grocery/orders/{id}` | details, "Order sent" | |
| `POST /grocery/orders/{id}/cancel` | details | only when `canCancel`; sends the revision on screen |

Messages come from the error `code` and `details[].code`, never from server text. A `409` on cancellation reloads the order and says why.

## No duplicate orders

- A key (`crypto.randomUUID`) is bound to the exact request body. The submission lives in the draft store, not in a page, so a double click or navigating away shares one request.
- **Refused** (the server said no): nothing was stored; the draft stays editable; a later send uses a new key.
- **Unknown** (no answer, a 30 s timeout, a `5xx` other than `grocery_unavailable`, or an unreadable answer): the draft is **locked**. The one action that sends is "Send the same order again", with the same key and body. On such a retry `400`, `401`, `403` and `429` also leave it unknown, because the server can give them before it looks the key up.
- Editing instead needs a confirmation that tells the customer to check My Grocery Orders first.
- While a send is unresolved, the browser asks before a reload or tab close.

**Limit:** the attempt lives in memory. If the tab is closed or reloaded while the outcome is unknown, the key is lost; a rewritten order would then be a second one if the first had arrived. The server's active-order limit bounds this; the screen tells the customer to check their orders.

## Privacy

- The draft (list, name, phone, address) is **in memory only**: never `localStorage`, `sessionStorage` or IndexedDB. A full reload empties it.
- It belongs to the account that wrote it. Signing out clears it; another account clears it; an **expired** session keeps it **hidden** until the same account signs in. A list written while signed out is adopted by whoever signs in next in that tab.
- Order lists show no name, phone or address. Private reads are keyed by account and held only by the screen showing them.
- The service worker never handles `/api/…`, so no order is cached by it; the API also sends `no-store`.
- **Sign-in and the draft:** e-mail sign-in keeps the list. **Google sign-in reloads the page, so a list written before it is not kept**; the list screen says so and offers signing in first. E-mail verification opens a link: keeping the original tab open keeps the list.

## Honesty rules the screens follow

- Nothing claims ordering works unless availability says so; an unreachable server is an error, never an open shop.
- A recorded price is "Recorded by our team after a phone call": **never** the customer's own approval or consent.
- "Paid" appears only from the server's payment record, never from the status.
- A failed delivery shows the order back in `preparing`, not delivered or paid.
- No live tracking: a "Refresh status" button, a re-check on returning to the tab (not more than every 15 s, not for finished orders), and the time last checked. No polling.
- A team cancellation gives no reason (the API sends none); the screen says the team tells customers directly.

## Not covered

No real-device testing; English only (D18); the real-stack browser lane has no Grocery spec yet; nothing was run against an enabled real backend.

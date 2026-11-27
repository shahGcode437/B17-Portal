# Grocery by request — the frontend (customer: GROCERY-3A; staff: GROCERY-3B)

**Built:** the customer's side (GROCERY-3A) and the staff order workspace (GROCERY-3B, below). **Not built:** the Super Admin's Grocery settings screens and Grocery staff appointment (their backend APIs exist, `docs/backend/API_CONTRACT.md` §18.6 and `AUTH_RBAC.md`; nothing in the frontend calls them for Grocery). **Both sides have been tested only against fakes, never a running backend. Grocery is disabled by default with no serviceable block, and is not production-ready** (`docs/backend/DEPLOYMENT.md` §15–§17).

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

---

# The staff workspace (GROCERY-3B)

Frontend only, on the GROCERY-2 API as built (`API_CONTRACT.md` §19; the backend code is the contract). No backend, migration or dependency change.

## Routes and who may use them

| Route | Screen |
|---|---|
| `/admin/grocery` | open-order summary and the queue |
| `/admin/grocery/:orderId` | one order, everything needed to handle it, and its actions |

| Account (from `/auth/me`) | The grocery workspace | The other `/admin` areas |
|---|---|---|
| Super Admin | yes: may act on any order without claiming it, release anyone's, cancel while preparing | yes (unchanged) |
| Moderator **with** the `grocery` scope | yes: must hold an order to work on it | no ("Admin access only"); the staff navigation shows Grocery only |
| Moderator with other scopes only, or paused | "Grocery staff access only"; no staff request is made | no |
| Resident, professional | the same | no |
| Staff with an unverified e-mail | asked to verify first | unchanged |
| Signed out | sent to the staff sign-in (`/admin/login`), then back | unchanged |
| **Anyone's own order** | never listed or counted; its staff page says it is their own and links to the customer page, which works as before | — |

- A **separate gate**, `AuthGate requires="grocery-staff"`; `requires="admin"` is unchanged and still guards every other staff page. The gate decides what to show; **the API decides every request**.
- `/admin/login` is the staff sign-in: an administrator goes on as before, a grocery Moderator goes to `/admin/grocery`.
- Ways in: "Grocery" in the staff navigation; for a grocery Moderator, a "Grocery staff" button on the account page.

## The workflow on screen

1. **Queue** (opens on new orders, longest-waiting first). "Open orders" shows, from the server's counts, what nobody has claimed and what is assigned to you; each figure links to exactly those orders. Filters: status (with counts), order reference, day sent, assigned to (anyone, me, nobody, or a colleague through "All orders held by …" on one of their orders), oldest or newest; 12 per page. Rows carry no name, phone, address or item text.
2. **Claim**, then **call** the customer (a `tel:` link built by `lib/phone.ts` from the stored number).
3. **Record the agreement**: items, service fee, delivery fee, the total the customer agreed to (typed, and it must equal the parts), how they agreed, **whether they accepted any substitute** (no default; if yes, a note saying which), notes, and the statement that they agreed (not pre-ticked). A **new agreement** always needs a note; earlier ones stay on screen as history. The screens call it a staff record, never the customer's approval.
4. **Start preparing → send out for delivery → record delivery and cash.** The cash field is empty and must equal the amount due; no part payment, refund or credit. **Failed delivery** (with a reason) returns the order to preparing.
5. **Lower the amount due** (only down, with a reason), **cancel** (with a reason; while preparing only a Super Admin, who must acknowledge that goods may be bought; never while out for delivery) and **record an issue** (any staff member, any status; nothing marks one resolved).

Only what the server lists in `availableActions` is offered, with a sentence saying why the rest is missing.

## API integration (all 13 staff endpoints, all under `/api/v1/admin/grocery/orders`)

| Call | Where in the app | Body sent |
|---|---|---|
| `GET /` | queue; the two "Open orders" summaries (`limit=1`, `assigned=unassigned` / `me`) | `status reference submittedOn assigned sort limit offset` |
| `GET /{id}` | order page | — |
| `POST /{id}/claim` | "Claim order" | none |
| `POST /{id}/release` | "Release order" (confirmed in a dialog) | none |
| `POST /{id}/confirm` | "Record agreement" | `revision itemsSubtotalPaisa serviceFeePaisa deliveryFeePaisa agreedTotalPaisa customerAgreed:true method substitutionsAgreed pricingNote? consentNote?` |
| `POST /{id}/reconfirm` | "Record new agreement" | the same, `consentNote` required |
| `POST /{id}/reduce-amount` | "Lower amount due" | `revision finalAmountPaisa reason` |
| `POST /{id}/start-preparing` | "Start preparing" | `revision` |
| `POST /{id}/dispatch` | "Send out for delivery" | `revision note?` |
| `POST /{id}/delivery-failed` | "Record failed delivery" | `revision reason` |
| `POST /{id}/complete` | "Record delivery and cash" | `revision amountCollectedPaisa` |
| `POST /{id}/cancel` | "Cancel order" | `revision reason procurementAcknowledged?` |
| `POST /{id}/issues` | "Record issue" | `kind note` |

The screen never reads `GET /admin/grocery/settings` (Super Admin only): the largest order allowed is known to the server alone, and its `exceeds_order_limit` refusal is shown. The only fixed bound in the app is the API's own limit on one amount field.

## Money

Rupees are turned into whole paisa **from the digits** (never `rupees × 100` in floating point). A comma is accepted only as correct thousands grouping; more than two decimals are refused.

## How every change is made

- One at a time per order **for the whole tab** (leaving and reopening an order cannot start a second), sent once, with a 30 s limit. Nothing changes on screen until the server answers with the order; it is then loaded again.
- **No automatic retry of any kind**, including the API client's usual replay after a stale CSRF token (`replayAfterCsrfRefresh: false`): by then another account may be signed in to the browser.
- **Conflict** (`409`, own order, "Super Admin only", lost access, `404`): the form closes, the page explains, the order is loaded again.
- A form **cannot send** if the order's revision, or the action's availability, changed while it was open.
- **Unknown outcome** (no answer, time limit, `5xx` other than `grocery_unavailable`, unreadable answer): nothing is resent; **every action is disabled until a newer copy of the order has loaded**, and the page then asks the person to check before repeating it.
- `422`, `429` and a CSRF refusal keep the form and what was typed, with a message from the error codes (never the server's text).

## Security and privacy

- Staff data lives only in the screen that loaded it: no web storage, IndexedDB or app-wide store. Reads are keyed by account (and order); the workspace is remounted when the account changes.
- On returning to the tab, coming back online and on "Refresh", the app first asks who is signed in. A different account, removed or paused access, or a sign-out closes or rebuilds the screen **before** any staff data is requested again.
- A refused read (`401`, `403`, `404`) **drops what was already on screen**.
- An expired staff session (`401 session_expired`) signs the browser out and returns to the staff sign-in. Logging out clears the screen.
- Nothing about a customer is put in an address, the document title or the console. Filters in the address hold a status, a reference, a day, an assignee id, a sort and a page.
- The service worker handles no `/api/` request; the API sends `no-store`. CSRF and Origin rules are unchanged.
- Staff wire types (`dto/groceryStaff.ts`) are separate from the customer's, and a test stops anything outside the staff workspace and the API layer importing them.

## Where the code is

```
src/lib/api/{dto,reads,writes}/groceryStaff.ts   the staff contract
src/lib/staffAccess.ts                           who may work grocery orders
src/features/grocery-staff/                      queue and order screens, forms, and the rules:
  money.ts   queueFilters.ts   staffLabels.ts   staffErrors.ts
  useStaffOrderWrite.ts (every change)   useStaffSession.ts (identity and refresh)   writeLock.ts
src/test/fixtures/groceryStaffBackend.ts         the staff contract in memory (tests only)
```

Reused from GROCERY-3A: status badge and wording, money and time formats, quantities, `useRefreshableRead` (which gained `forgetOn`), `AttentionRegion`, form fields. The one change to shared infrastructure is the API client's `replayAfterCsrfRefresh` option.

## Known limitations

- **Not verified against a real backend.** The staff fake was written from `grocery_staff_orders.py`; it does not model locking, the 2 h / 12 h freshness windows (tests inject their answer) or the server's free-text rules. It could drift from the server.
- **No notifications and no polling:** a new order appears only after "Refresh" or returning to the tab. Staff must look.
- The largest order allowed is learned only from the server's refusal.
- Choosing an arbitrary colleague in the filter is not offered: Moderators have no staff directory.
- After an unknown outcome, a very slow request can still arrive **after** the reload. The revision protects every change that carries one, and claiming twice changes nothing; **an issue could be recorded twice**.
- A staff session idle for over 2 hours, or older than 12, is refused by the staff routes while the same cookie still works for ordinary pages. The app signs itself out locally (the client's existing rule); a reload shows the account signed in again, and signing in again restores staff access.
- What is already on screen stays visible while offline (memory only).
- No issue resolution, refunds, partial payment, or record of who viewed contact details (not in the backend).
- No real-device or screen-reader testing; English only.

## Outstanding integration risks (both sides)

No real-stack (React → FastAPI → PostgreSQL) Grocery test exists for the customer or the staff side; migrations `0010`–`0012` have not been applied to `b17_dev`; a customer's list written before **Google** sign-in is still lost; a customer's unresolved submission key is still lost on reload.

## Before a pilot

Everything in `DEPLOYMENT.md` §15–§17 that these screens do not close, including: **no screen to configure or enable Grocery or to appoint grocery staff** (proposed GROCERY-3C); a real-backend run of both sides; the owner-verified block list; refund, privacy / retention, excluded-goods and cash-handling policies; written rules for failed deliveries and goods already bought; a routine for telling customers about cancellations, substitutions and failed deliveries, and for **noticing new orders**; staff MFA; per-IP rate limiting at the proxy; backups with a tested restore; monitoring.

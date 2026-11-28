# Grocery by request — the frontend (customer: GROCERY-3A; staff: GROCERY-3B; administration: GROCERY-3C)

**Built:** the customer's side (GROCERY-3A), the staff order workspace (GROCERY-3B, below) and the Super Admin's Grocery settings and portal staff management (GROCERY-3C, at the end). **All of it has been tested only against fakes, never a running backend. Grocery is disabled by default with no serviceable block, and is not production-ready** (`docs/backend/DEPLOYMENT.md` §15–§17).

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
- **No automatic retry of any kind.** The API client never re-sends a request, after a stale CSRF token or otherwise (`AUTH_RBAC.md` §23.1): by then another account may be signed in to the browser.
- **Conflict** (`409`, own order, "Super Admin only", lost access, `404`): the form closes, the page explains, the order is loaded again.
- A form **cannot send** if the order's revision, or the action's availability, changed while it was open.
- **Unknown outcome** (no answer, time limit, `5xx` other than `grocery_unavailable`, unreadable answer): nothing is resent; **every action is disabled until a newer copy of the order has loaded**, and the page then asks the person to check before repeating it.
- `422`, `429` and a CSRF refusal keep the form and what was typed, with a message from the error codes (never the server's text).

## Security and privacy

- Staff data lives only in the screen that loaded it: no web storage, IndexedDB or app-wide store. Reads are keyed by account (and order); the workspace is remounted when the account changes.
- Returning to the tab or coming back online only asks who is signed in; **it loads no staff data**. "Refresh" asks first and then loads. A different account, removed or paused access, or a sign-out closes or rebuilds the screen **before** any staff data is requested again. An expired staff session is found at the next staff request; until then the screen keeps what it had loaded (`AUTH_RBAC.md` §38.4).
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

Reused from GROCERY-3A: status badge and wording, money and time formats, quantities, `useRefreshableRead` (which gained `forgetOn`), `AttentionRegion`, form fields. The one change to shared infrastructure was a no-replay option on the API client (since 2026-11-28 the client never replays, and the option is gone).

## Known limitations

- **Not verified against a real backend.** The staff fake was written from `grocery_staff_orders.py`; it does not model locking, the 2 h / 12 h freshness windows (tests inject their answer) or the server's free-text rules. It could drift from the server.
- **No notifications and no polling:** on an open screen a new order appears only after "Refresh". Staff must look.
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

Everything in `DEPLOYMENT.md` §15–§17 that these screens do not close, including: the settings and staff screens (built in GROCERY-3C, below) not yet run against a real backend; a real-backend run of both sides; the owner-verified block list; refund, privacy / retention, excluded-goods and cash-handling policies; written rules for failed deliveries and goods already bought; a routine for telling customers about cancellations, substitutions and failed deliveries, and for **noticing new orders**; staff MFA; per-IP rate limiting at the proxy; backups with a tested restore; monitoring.

---

# Administration: Grocery settings and staff management (GROCERY-3C)

Frontend only, on the settings API (`API_CONTRACT.md` §18.6, §19) and the staff-management API (`AUTH_RBAC.md` §30) **as built**; the backend code is the contract. No backend, migration or dependency change.

## Routes and who may use them

| Route | Screen |
|---|---|
| `/admin/grocery/settings` | Grocery operating settings (reached by "Grocery settings" on the grocery queue) |
| `/admin/staff` | portal staff: list, one person, appoint, change, pause, resume, remove (staff navigation: "Staff") |
| `/admin/staff/history` | the durable staff audit, read-only |

All three sit behind the **existing `admin` gate** (Super Admin only). `/admin/grocery/settings` outranks `/admin/grocery/:orderId`; `routeIntegrity.test.tsx` checks the gate of every staff and admin page on the real router.

| Account | Settings, staff, history | Grocery workspace | Other admin pages |
|---|---|---|---|
| Super Admin | yes | yes | yes |
| Moderator with `grocery` | "Admin access only", **no admin request** | yes | no |
| Moderator with other scopes, or paused | the same | no | no |
| Resident, professional | the same | no | no |
| Signed out | staff sign-in, then back | the same | the same |

## Sign-in freshness (read from the backend, not assumed)

| Operation | What the server requires |
|---|---|
| Grocery settings read and change | Super Admin, staff session used within 2 h and created within 12 h. **No** 15-minute window |
| Staff list and audit (reads) | the same |
| Staff changes (all five) | the same **and** a session **created** within `STAFF_SENSITIVE_WINDOW_MINUTES` (default 15; hosted environments cannot raise it) |
| Grocery order handling | grocery authority, 2 h / 12 h |

- An idle or over-age session is `401 session_expired`: the app signs out locally and returns to the staff sign-in (unchanged client rule).
- A too-old sign-in on a staff change is `403 forbidden` with `sensitive_reauth_required`. It is **not** a lost session or lost access. The dialog stays, nothing more can be sent from it, and it offers **"Sign out and sign in again"**.
- **There is no re-authentication request in the backend.** Signing out and in is the supported way. The app signs out, the gate sends the person to `/admin/login`, which returns them to `/admin/staff`. A link there leads to the main Log In for **Google** sign-in (the staff sign-in form is e-mail and password only).
- **Nothing is carried over or sent afterwards.** The screen is rebuilt, the records are read again, and the change must be chosen and confirmed again. The app cannot know in advance how old a session is (`/auth/me` does not say), so the page states the rule and offers "Sign in again" before starting.
- This is the backend's **interim** approximation of recent authentication (`AUTH_RBAC.md` §27.7). **MFA does not exist and remains a launch blocker.**

## Grocery settings

| Call | Used for | Body |
|---|---|---|
| `GET /admin/grocery/settings` | the page | — |
| `PATCH /admin/grocery/settings` | "Save settings" | `revision` and **only the changed** fields |

Editable (every field the API takes with more than one allowed value): ordering on / off, delivery blocks, operating days, opening and closing time, orders per day, open orders per customer, items per order, largest order total. **The time zone is shown, not editable** (the API allows only `Asia/Karachi`). Field bounds are the API's (blocks: up to 100 of up to 40 characters; capacity 1–200; items 1–100; open orders 1–10; total Rs 1 to Rs 1,000,000; closing after opening, no overnight hours). No block name is suggested.

- Saved and unsaved are shown apart: each changed field names the saved value; a bar counts the changes.
- Every save goes through a review listing old → new and what it means. **Switching ordering on or off also needs its own tick.** One send; nothing shown as saved before the server answers.
- **Concurrency** is the server's `revision` (`409 stale_revision`). If a newer version arrives while edits are open, the page shows what changed there and what was edited here (flagging fields both changed) and offers **keep my edits on the new version** (only the edited fields; sends nothing) or **discard**. A review left open cannot save an old version.
- Leaving the page with unsaved edits asks first; so does reloading or closing the tab. **Signing out does not ask:** the edits are discarded with the screen.
- **What changes affect** (backend rules): availability, blocks, hours, capacity and item / order limits apply to orders sent afterwards. Existing orders stay and staff can still handle them while ordering is off. **The largest total is also checked at every later agreement on existing orders.**
- **No history:** the server keeps every version with its actor, but the API reads only the current one, and the staff audit has no settings entries. The page shows only the current version, when it was saved and the recorded person ("No person is recorded" when none is).

## Staff management

Portal-level, not Grocery-only. It uses the backend's own terms and operations.

| Call | Used for | Body |
|---|---|---|
| `GET /admin/staff` `?limit&offset` | the list; **also** to look one person up (there is no one-person read) | — |
| `GET /admin/audit` `?action&target&limit&offset` | staff history; one person's recorded changes | — |
| `POST /admin/staff/moderators` | appoint | `email, scopes` |
| `PUT /admin/staff/moderators/{id}/scopes` | change scopes (**replaces the whole set**) | `scopes` |
| `POST /admin/staff/moderators/{id}/pause` | pause | none |
| `POST /admin/staff/moderators/{id}/resume` | resume | `scopes` |
| `DELETE /admin/staff/moderators/{id}` | remove the moderator role | none |

- **Roles:** Super Admin (shown, **never changeable here**; promotion and demotion remain command-line only) and scoped Moderator. A professional profile is a separate thing.
- **Scopes:** the six assignable ones are offered, none preselected (resume included); `news` is reserved and never offered. **Grocery is separate**: no listing scope adds it. Only Grocery has a Moderator screen in this app; the others are enforced by the API and say so.
- **Appointment** is by the exact e-mail of an existing account, in two steps (details, then review with an "I've checked the address" tick). **There is no account search, and the app cannot check eligibility in advance.** Unknown, unverified and suspended accounts get one deliberately identical answer.
- **No reason field:** the web changes take none (only command-line changes record a reason).
- Every real change ends all of the person's sessions (an identical scope set changes nothing). Pausing, removing or taking Grocery away **does not reassign orders**: they stay assigned, **nobody else can claim them**, and a Super Admin must release them from the grocery queue. Each person's page links to their orders and the dialogs say this.
- **Professional accounts:** the backend neither requires nor forbids a professional profile for appointment, and the app adds no rule of its own.

### Concurrent staff changes

The API takes **no version** for staff changes. The server serialises them and refuses impossible ones (already paused, not paused, no longer a moderator, already appointed), but **a scope change replaces the whole set**. Just before sending, the app reads the person again and **sends nothing** if their role, scopes, pause or account state differ from what the dialog showed; a dialog whose person changes while open is blocked. **This narrows the chance of silently overwriting another Super Admin's change; it cannot close it.** Closing it needs a backend precondition (not approved).

## Safety, security and privacy

The rules of the staff workspace apply (no administrative change is ever re-sent; one change at a time per tab; 30 s limit; an **unknown outcome** is never resent and disables changes until newer records have loaded; identity checked before reloading; a refused read drops what was shown; screens rebuilt when the account changes). Staff e-mail addresses are on screen only: none is put in an address, browser storage, the console or a cache (the person being viewed is not in the URL). The service worker handles no `/api/` request.

## Where the code is

```
src/lib/api/{dto,reads,writes}/grocerySettings.ts, staffAdmin.ts
src/features/grocery-staff/settings/     settings page and its rules
src/features/staff-management/           staff list, person, dialogs, history and their rules
src/hooks/useGuardedWrite.ts             how every administrative change is made
src/hooks/useVerifiedReload.ts, useWriteLock.ts, useUnsavedChangesWarning.ts
src/components/forms/ConfirmDialog.tsx, CheckField.tsx; src/components/workspace/RefreshBar.tsx
src/test/fixtures/adminBackend.ts        the contract in memory (tests only)
```

The identity check, one-change lock, refresh bar, dialog frame and checkbox moved out of the grocery staff folder to be shared. `staff-management` still imports a few general helpers from `features/grocery` (labelled field, attention region, refreshable read, Pakistan-time formatting).

**Changed for existing users:** the staff navigation gains "Staff" and shows its **text labels only from 1024 px** (below that, named icons); the grocery queue has a "Grocery settings" button for a Super Admin; the staff sign-in shows a return note and a Google link when arriving from Staff.

## Not supported by the backend (and so not in the app)

Settings history; settings or order actions in the audit; a one-person staff read; account search or an eligibility check; a reason on web staff changes; a version precondition on staff changes; re-authentication without signing out; MFA; Super Admin promotion or demotion on the web; releasing or reassigning a removed person's orders automatically.

## Known limitations

- **Never run against a real backend.** The fakes are written from the service code and do not model locking or the session ages (a test switches the "recent sign-in" answer).
- The older replay risk flagged during this phase (other writes could run as another account signed in from a second tab) is **fixed by a separate security correction** (`AUTH_RBAC.md` §23.1). The customer's grocery submit and cancel are among the writes it covers; an unconfirmed order keeps its idempotency key. The correction also stops the re-read before a Moderator change from sending if the signed-in account changed while it waited.
- Looking one person up reads the roster in pages of 100 until they are found.
- Block-name comparison in the browser is close to, not identical with, the server's.
- No real-device or screen-reader testing; English only.

## GROCERY-4A: account isolation (applies to every Grocery screen)

Customer, staff and Super Admin screens follow `AUTH_RBAC.md` §23.2: a private answer is shown only once confirmed as this account's; other tabs are told when the sign-in changes and are covered while they check; a replaced screen shows no later message. The customer's draft, idempotency key and "unconfirmed" handling are unchanged. **Backend closure (§38, §39; migration `0013`):** the server refuses a private read whose named session is not the cookie's, no longer re-sends the session cookie, and refuses a staff change made from an outdated revision, so one Super Admin can't silently overwrite another's. Asking who is signed in no longer keeps an idle staff session alive (§38.4). **Still open:** clients that send no session name, and a late sign-out or `401` clearing a newer cookie (§38.2, §38.5).

## GROCERY-4B scope (foundation approved 2026-11-28; NOT started)

**Approved by the owner: integration verification is the foundation of GROCERY-4B** (the list below).

**To be added after their exact requirements are reviewed with the owner (not yet defined or approved in detail):** previously discussed customer-facing Grocery **wording**, **order reliability** and **simple payment flexibility**. **No complex payment gateway.** Today the schema and rules allow only cash on delivery, with the amount collected equal to the amount due (`DATA_MODEL.md` §22), so any payment change needs its requirements, and possibly a migration, approved first.

**Not part of GROCERY-4B:** pilot corrections (failed delivery and returns, D15; cash handling, D17; refunds, issue resolution and reconciliation only if approved). They need pilot experience, and the pilot is GROCERY-5.

**Verification foundation:**

1. A **throwaway** database migrated to head by the owner's process (`b17_dev` only if the owner decides to).
2. Real-stack browser specs. A first one exists (`e2e-real/18-grocery.spec.ts`, GROCERY-4A; run on a throwaway database): enable with a test block → customer sends → a grocery Moderator claims, agrees, prepares, dispatches and collects cash → customer sees it; another customer can't read it; a paused Moderator changes nothing. **Still to cover:** a failed delivery, cancellation by customer and staff, recorded issues, a reduced amount, releasing the orders of a paused or removed Moderator, and enabling and appointing through the screens.
3. Compare every fake with the real answers: shapes (absent fields), error codes and `details`, order of refusal, `401` / `403` kinds, rate limits, session ages.
4. Decide on a settings-history read (backend approval needed). The staff revision (`AUTH_RBAC.md` §39) and the server read binding (§38) are built.
5. A real-device pass of the customer, staff and admin screens.

**Launch blockers (all still open):** the mandatory pre-pilot security review of `DEPLOYMENT.md` §20; everything in `DEPLOYMENT.md` §15–§17, including verified serviceable blocks; refund, privacy / retention, excluded-goods and cash-handling policies; rules for failed deliveries and bought goods; routines for telling customers about changes and for **noticing new orders** (no notifications); several accounts filling a day's capacity; the 05:00 PKT limit reset; **staff MFA**; per-IP rate limiting at the proxy; tested backups; monitoring; least-privilege database credentials; production Google OAuth.

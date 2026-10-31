# B-17 Portal — Contact Model v1 (LOCKED)

**Status:** product decision **LOCKED** by the product owner on 2026-10-31. **Implementation: NOT STARTED.** This file is the one detailed source for the decision; `DECISIONS.md` carries the compact record, and `ROADMAP.md`, `CURRENT_STATE.md`, `API_CONTRACT.md`, `DATA_MODEL.md`, `FOOD_DINING.md` and `DESIGN_SYSTEM.md` only point here.

> **Read this first — CURRENT vs PLANNED.** Everything below the "Locked decision" heading describes what is **planned**, not what exists. Section 1 says exactly what exists today. A statement is only a description of the running product if it is in section 1.

**Naming.** Phase 12F recorded an earlier, narrower decision called the *Service Request Contact Model V1* (`DECISIONS.md`, O-3): a service request carries a **preferred contact channel** as metadata only. It still holds and is unchanged. *Contact Model v1* (this document) is the broader, later decision that answers that decision's own "Revisit when: listings or the requester get real contact data". Where both names could be confused, this file says "the 12F request preference" for the former.

---

## 1. CURRENT (what exists at `92769cc`)

| Area | Today |
|---|---|
| Service / Professional (`provider`) | **Request Service** works end to end: `ServiceRequest` (`submitted → accepted → in-progress → completed`, with cancellation per the existing rules), requester and provider dashboards ("My Requests", "Leads"), real API, history table. |
| Business / Food / Tutor / Property | **No contact action.** The detail pages say, honestly, "Contacting this business / tutor / the lister through B-17 Portal isn't available yet." (S2 removed the simulated Contact / WhatsApp buttons.) |
| Inquiry | **Does not exist** (no table, endpoint, screen or test). |
| Professional contact data | **Does not exist.** `professional_profiles` holds `user_id`, `plan_code` and timestamps only; no display name, bio, phone, WhatsApp or preference. `users` has the private `email`, `email_verified_at`, `display_name`, `status`; there is no phone or WhatsApp column anywhere. |
| Public phone / WhatsApp | **Does not exist** and nothing in the product can configure it. |
| Request form | S5A removed the WhatsApp / phone "preferred contact method" choice; the form sends `in_app`. The API still accepts `in_app`, `whatsapp`, `phone` so a historic request keeps its stored preference. |
| Notifications | **None.** No e-mail, SMS, WhatsApp or push delivery exists, and no screen may claim otherwise. |

## 2. Locked decision (PLANNED)

### 2.1 Two interaction models

| Listing kind | Primary CTA | Mechanism | Lifecycle |
|---|---|---|---|
| Service / Professional | **Request Service** | the **existing** `ServiceRequest` (not converted) | `submitted → accepted → in-progress → completed` (+ cancellation, existing rules) |
| Business / Shop | **Contact Business** | future `Inquiry` | `new → read → closed` |
| Food / Restaurant | **Order Inquiry** | future `Inquiry` | `new → read → closed` |
| Tutor | **Contact Tutor** | future `Inquiry` | `new → read → closed` |
| Property | **Contact Lister** | future `Inquiry` | `new → read → closed` |

An Inquiry has **no** `accepted`, `start work`, `in-progress` or `completed` semantics. Provider requests are never migrated into the Inquiry model.

### 2.2 Contact authority

```
User                 -> authentication identity (private e-mail, password / OAuth)
ProfessionalProfile  -> public professional identity, contact information, contact preferences
Listing              -> Provider / Business / Food / Tutor / Property
```

Public contact configuration belongs to the **ProfessionalProfile**, not to the authentication `User`. Future profile fields may include: display name, bio, phone number, WhatsApp number, allow in-app inquiries, show phone publicly, show WhatsApp publicly, preferred contact channel, business hours. **None of these exist and none is added by this decision.**

### 2.3 Privacy rules (locked defaults)

- In-app interaction is supported.
- Phone is **private by default**; WhatsApp is **private by default**.
- An explicit owner **opt-in** is required before either becomes public.
- The public UI must **never present a contact method the product cannot fulfil.** No fake WhatsApp button, no fake Call button, and no wording such as "if the provider shares a number" while there is no product path to configure one.
- Nothing may expose the private account e-mail, a phone number the owner did not publish, a precise private location or a hidden address.

### 2.4 Future Inquiry entity (conceptual, not a schema)

`id`, `requester_user_id`, `listing_id`, `owner_user_id`, `listing_kind`, subject / message as appropriate, `status`, `created_at`, `read_at`, `closed_at`, `preferred_contact_channel`.

- The backend **derives the owner from the listing**; the client never supplies `owner_user_id`.
- Eligibility: the listing is **approved**; its kind is Business, Food, Tutor or Property; the requester is **verified**; the requester is **not the owner**.
- Provider listings keep using `ServiceRequest`.
- Suggested limits for the implementation: message **5 to 1000 characters**; **no attachments** in v1; **no hard-delete UI** initially (use `closed`).

### 2.5 Auth and intent rules for the future Contact CTA

| Visitor | Behaviour |
|---|---|
| Anonymous | Contact CTA → Sign in → return to the **same listing** → resume the contact intent |
| Signed in, e-mail unverified | "Verify your email first" (the same step Request Service already shows) |
| Verified | Open the inquiry flow |

The requester does **not** need a ProfessionalProfile. A person cannot inquire on their own listing; the owner is directed to manage it instead. Return URLs stay internal and safe (`src/lib/safePath.ts` rules).

### 2.6 Channels

Possible channels: `in_app`, `whatsapp`, `phone`. **Only channels the owner has genuinely configured and enabled are exposed.** Example: `allow_in_app_inquiries = true`, `show_whatsapp_publicly = true`, `show_phone_publicly = false` → the UI may show *In-app* and *WhatsApp* and **must not** show *Phone*.

### 2.7 Food and Property

- **Food:** primary CTA is **Order Inquiry**. Contact Model v1 does **not** include a cart, checkout, payment or order lifecycle (they stay on the `Do Not Build Yet` list).
- **Property:** primary CTA is **Contact Lister**; WhatsApp and Call only as secondary actions, and only if the owner explicitly enabled them. **No visit-booking scheduler** in v1.

### 2.8 Dashboard information architecture

| Side | Provider requests | Business / Food / Tutor / Property |
|---|---|---|
| Professional | **Service Leads** (today's "Leads": `ServiceRequest`) | **Inquiries** |
| Resident | **My Requests** | **My Inquiries** |

The two are never merged into one generic lifecycle.

### 2.9 Notifications

Nothing promises e-mail, SMS or WhatsApp notification until real delivery infrastructure exists. A future design may emit events for a delivery layer, but creating an Inquiry must **not** depend directly on an external provider.

### 2.10 Security and validation principles for the eventual implementation

Verified requester; CSRF protection; server-side authorization; approved listing only; no self-inquiry; rate limiting; no raw HTML; hidden / control-character validation; message min / max validation; **no arbitrary user-provided WhatsApp URLs**; **server-normalized phone numbers**; no exposure of the private account e-mail, phone, precise location or hidden address.

### 2.11 Listing-specific overrides

**Not part of v1.** ProfessionalProfile preferences apply to all of the owner's listings. A per-listing override may be introduced later only if a real need appears.

### 2.12 Constraint on the visual redesign

The redesign must reserve the CTA hierarchy: Provider **Request Service**, Business **Contact Business**, Food **Order Inquiry**, Tutor **Contact Tutor**, Property **Contact Lister**. Secondary WhatsApp / Call actions exist in the design **only where real capability data can enable them**. No fake or disabled buttons for visual completeness.

## 3. Recommended implementation order (after the redesign)

1. **Phase 13A** — real media / storage.
2. **Phase 13B** — ProfessionalProfile contact fields and preferences.
3. **Phase 13C** — Inquiry model, API and inbox.
4. Production notification integrations, later.

See section 5 for how this sits next to the existing Phase 13 in `ROADMAP.md` (a scope conflict is reported there, not silently resolved).

## 4. Architecture compatibility review (at `92769cc`, read-only; nothing was changed)

1. **ProfessionalProfile today.** Table `professional_profiles`: `user_id` (UUID, primary key and foreign key to `users`, `ON DELETE CASCADE`), `plan_code` (`free` | `premium`, CHECK), `created_at` / `updated_at`. Created lazily by the idempotent `PUT /users/me/professional-profile` (verified user, **empty body; any key is `422 not_allowed`**, "no client-writable field"). Professional is a *capability*, not a role; `/auth/me` reports `professional: { planCode }`. It has no profile content at all.
2. **User / contact fields.** `users`: `email` (private, normalized, unique case-insensitively), `email_verified_at`, `display_name` (≤ 60, ≥ 2), `password_hash`, `status`, `last_login_at`; `auth_identities.provider_email` (private). **No phone, WhatsApp, bio or avatar anywhere in the database or the DTOs.** A requester is shown to a provider by display name only.
3. **Listing ownership.** `listings.owner_id` is a nullable UUID, `ON DELETE RESTRICT` (NULL = admin-curated / unclaimed). Kinds `provider | business | tutor | property` (Food is a business with `vertical = food`); status `pending | approved | rejected | archived`.
4. **ServiceRequest ownership / security pattern.** `service_requests`: `requester_id` (RESTRICT), `provider_listing_id` (SET NULL, plus `provider_name_snapshot`), `preferred_contact_channel` (metadata), `status`; an append-only `service_request_status_history` with `actor_user_id` and `actor_role`. The provider is **not stored on the request**: it is derived from the listing at read time. Create is `VerifiedUser`, takes the requester from the session and the provider from the listing, runs under a per-requester advisory lock with rate limits (5 per hour per requester, 1 per day per requester and provider), and refuses a missing or non-approved listing (`404`), a non-provider kind (`422 not_requestable`) and the requester's own listing (`422 own_listing`). Reads and actions are `CurrentUser` plus a party check that answers **404 to anyone who is not a party**; the provider inbox is `GET /users/me/leads` (`ProfessionalUser`); every response is `Cache-Control: no-store`.
5. **Dashboard navigation.** Professional workspace tabs: Overview, Listings, **Leads** (`/provider/leads`), Analytics, Profile (`/provider/profile`). Resident "Account" tabs: Overview, Saved, **My Requests** (`/profile/requests`). The plan capability string `leads.basic` is on both plans. "Leads" currently means `ServiceRequest` only.
6. **Best future place for Inquiry endpoints.** A new router `backend/app/api/v1/inquiries.py` registered beside `requests.py` in `router.py`, with `models/inquiries.py`, `schemas/inquiries.py`, `repositories/inquiries.py` and `services/inquiries.py` (+ rules and reads) mirroring the request layering (HTTP only in the router; one transaction in the service). Tentative surface: `POST /inquiries`, `GET /inquiries` (mine), `GET /inquiries/{id}`, owner inbox `GET /users/me/inquiries` (mirrors `/users/me/leads`), owner actions to mark read / close. Contact settings belong on the profile (13B), not on the listing routes. Not a contract: the exact shapes are decided in 13B / 13C.
7. **Likely migration scope** (additive only, no data statement, no change to `listings` or the search index): **`0007`** (13B) adds nullable / defaulted-private contact columns to `professional_profiles`; **`0008`** (13C) adds an `inquiries` table with vocabulary CHECKs, message-length CHECKs, and indexes for (requester, newest first) and (owner, status, newest first). Media (13A) has its own migrations first (`media_assets`, per `MEDIA_STORAGE.md`), so the numbers above move accordingly.
8. **Likely frontend surfaces.** The four non-provider detail pages (Business and Food share `BusinessProfilePage`; Tutor; Property: they replace today's "isn't available yet" notes with the CTA); a new inquiry dialog / form with the same verify-first step as `RequestServiceDialog`; a **generalized** sign-in intent (see 10); Professional Profile page (contact settings, opt-ins); Professional nav ("Leads" becomes "Service Leads" and an **Inquiries** tab is added) and resident nav (a **My Inquiries** tab); overview tiles; analytics counts; route and SEO entries; public DTOs / adapters for a `contact` capability object; mock backend and fixtures; the guard tests listed in 10.
9. **Conflicts with Contact Model v1.** See section 5.
10. **Existing code that assumes the current contact situation** (nothing is wrong today; each item needs a deliberate update when the feature ships):
    - `src/features/detail.pages.test.tsx` ("no simulated contact action on any public detail page") asserts there is **no** control matching `/whatsapp|contact|chat/i` and the "isn't available yet" note on Business, Food, Tutor and Property; **Contact Business** would fail it by design.
    - `src/architecture.test.ts` ("no simulated contact action exists") forbids button text `Contact Business`, `Contact Agent`, `Contact`, `WhatsApp`; it needs a real-feature allowance.
    - `LoginRegisterPage` resumes only a **provider** Request Service (`state.providerId` → `openRequestFor`); the sign-in intent is not generic yet (`useSignInGate`'s `loginState` is).
    - `ProviderProfilePage` is the only caller of `RequestServiceDialog`; the backend refuses a non-provider with `422 not_requestable`, which `writeErrors` shows as "This listing cannot receive requests. Only approved service providers can be requested right now." (accurate today; it should point to the new CTA once one exists).
    - The request dialog copy says B-17 Portal does not pass on the requester's phone or WhatsApp number; revisit in 13B when numbers can become public.
    - `docs/product/FOOD_DINING.md` still described a "Call / WhatsApp" end of the journey (the actions S2 removed); corrected in the same documentation change as this file.
    - Observation (not a Contact Model change): the copy guard `src/copy.test.ts` looks for the literal `isn't available yet`, but the three detail-page notes are written as `isn&apos;t` in JSX, so the guard does not see them.
    - Observation: a service request to a **provider listing with `owner_id = NULL`** (admin-curated / unclaimed) is accepted today and has no recipient. Inquiry must refuse an ownerless listing explicitly.

## 5. Conflicts and tensions found (reported, not resolved here)

1. **Name collision.** "Contact Model V1" already names the 12F request preference. Resolved in the documents by always writing "the 12F request preference" vs "Contact Model v1", not by renaming either decision.
2. **Phase 13 scope.** `ROADMAP.md` defines Phase 13 as **Media Storage & Production Deployment** (media, hosting, managed PostgreSQL, **transactional e-mail**, OAuth configuration, domain, CDN / WAF, observability, backups, secrets, smoke test, CI real-stack job). The approved order makes 13A media only and inserts 13B / 13C (contact) after it. **Open question for the product owner:** where does the production-deployment half go (a later 13D, or ahead of 13B / 13C)? The approved order is recorded as given; the roadmap keeps the deployment items as an unscheduled remainder of Phase 13.
3. **Phase 9I (Notifications + Trust/Reviews UI shell).** As written it populates a bell icon "from mock/local events". That conflicts with the locked rule that nothing may promise a notification before real delivery exists, and with the project's "no simulated actions" stance. 9I is **not** changed here; a note was added to the roadmap and the item must be re-scoped before it is built.
4. **`ServiceRequest.preferred_contact_channel`** still accepts `whatsapp` and `phone`, while the locked rule says only genuinely configured channels may be exposed. Harmless today (metadata; the form no longer offers them). Open question for 13B / 13C: narrow the request's allowed channels to the provider's configured ones.
5. **`PUT /users/me/professional-profile`** is documented as taking an empty body with no client-writable field. Contact preferences will be the first writable profile fields, so 13B changes that contract (a new route or an extended one).
6. **Public read shapes carry no contact data today** (`DATA_MODEL.md`: "No contact data anywhere"). 13B/13C must add a deliberately minimal public `contact` capability object (which channels are enabled, never raw numbers unless the owner opted in) and keep contact data **out of the search index and the search document**.
7. **Stored owner vs derived owner.** The Inquiry entity lists `owner_user_id`; `ServiceRequest` derives the provider from the listing at read time. Either is compatible with "the backend derives the owner from the listing" (a stored value is copied from the listing at create); the difference should be a conscious choice in 13C (a snapshot survives a future ownership change).
8. **"Leads" vocabulary** (the nav label, the route `/provider/leads`, the `leads.basic` capability, `ProfessionalLeadsPage`, `LeadSummaryCard`, `LeadDetailDialog`) means `ServiceRequest` only; the locked IA ("Service Leads" vs "Inquiries") needs a rename at implementation time, not now.

No conflict was found with: the verified-requester and no-self-contact rules (the same pattern already exists), the approved-listing-only rule, the `no-store` / party-404 security pattern, the Food and Property decisions (cart, payment and booking stay on the not-yet list), or the location-privacy rules (Inquiry carries no location).

## 6. Open questions (not decided by this document)

- Where production deployment (hosting, transactional e-mail, OAuth, domain) sits relative to 13B / 13C (section 5, item 2).
- Whether `ServiceRequest` should accept only the provider's configured channels (section 5, item 4).
- Whether an Inquiry stores a copy of `owner_user_id` and a listing-title snapshot (the `ServiceRequest` pattern keeps a name snapshot) or derives both at read time.
- The exact public `contact` shape, phone normalization rules (country, E.164) and the WhatsApp link construction (server-side only; never a user-supplied URL).
- Whether closing an Inquiry is available to the requester as well as the owner.

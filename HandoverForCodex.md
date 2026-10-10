# **SYSTEM CONTEXT & HANDOVER DOCUMENT**

**Project Name:** LogisPro (B2B Logistics Platform)

**Architecture:** Multi-Tenant SaaS (Isolated data per company)

**Target Audience:** AI Coding Assistant (Codex / Cursor / Copilot)

## **1\. PROJECT OVERVIEW**

LogisPro is a multi-tenant B2B logistics management platform. Companies register, invite their employees via a unique join\_code, and manage their clients, delivery zones, and daily package movements.

The primary product audience is small and medium self-managed last-mile teams, especially groups that receive Mercado Libre or ecommerce shipments, divide them among their own drivers, and currently coordinate intake, delivery evidence, weekly totals, commissions, and collections through paper, spreadsheets, photos, and chat messages. The product must win through mobile comfort and trustworthy automation rather than through feature count alone.

Security and data isolation are handled strictly at the database level using PostgreSQL Row Level Security (RLS) via Supabase.

## **2\. TECH STACK & ENVIRONMENT**

* **Frontend Framework:** React 19 \+ Vite  
* **Language:** TypeScript (Strict Mode enabled)  
* **Styling:** Tailwind CSS **v4** (Strict Rule: Do not generate tailwind.config.js or postcss.config.js. Setup uses @tailwindcss/vite and @import "tailwindcss"; in CSS).  
* **Icons:** lucide-react  
* **Maps:** Leaflet + React-Leaflet with standard OpenStreetMap tiles (no API keys)  
* **Backend as a Service:** Supabase (PostgreSQL, Auth, RLS)  
* **State Management:** React state for UI, Supabase client for data.

## **3\. DATABASE ARCHITECTURE & MULTI-TENANCY (CRITICAL)**

The core logic relies on a multi-tenant architecture. The database schema is already implemented in Supabase and relies on the companies table as the central entity.

**Core Tables & Relationships (Already Deployed):**

1. **companies**: id (UUID, PK), name, join\_code (varchar).  
2. **profiles**: id (UUID, PK, FK to auth.users.id), company\_id (FK to companies.id), full\_name, role (varchar), status (varchar). *This table acts as the bridge between Supabase Auth and the tenant.*  
3. **zones**: id (PK), company\_id (FK), name, zone\_type (`group`/`city`), coordinates, color, and optional external place identity.  
4. **zone\_locations**: id (PK), company\_id (FK), group\_zone\_id (FK), location\_type (`city`/`custom`), name, coordinates, and optional external place identity.  
5. **clients**: id (PK), company\_id (FK), business\_name, contact\_email, status.  
6. **shipments**: id (PK), company\_id (FK), client\_id (FK), zone\_id (FK), tracking\_number, shipment\_date, status, delivery\_address, and geocoded destination city fields.
7. **notifications**: recipient-scoped in-app notifications with type, entity reference, read state, metadata, and creation timestamp.
8. **audit\_events**: tenant-owned immutable audit records for membership decisions, including actor and before/after status.
9. **company\_roles**, **permissions**, **company\_role\_permissions**: company-defined employee capabilities enforced in PostgreSQL.
10. **company\_settings** and **user\_preferences**: tenant branding/operational defaults and profile-scoped UI preferences.

**Security Paradigm (Row Level Security \- RLS):**

The AI must rely on Supabase RLS for data isolation. **Do not write complex frontend logic to filter data by company**; the database does this automatically based on the authenticated user.

*Current RLS Implementation Goals:*

* Users should only SELECT/UPDATE data where the company\_id matches the company\_id in their profile.  
* During registration, specific policies allow inserting a new company or a profile linked to an existing company via join\_code.

## **4\. PROGRESS CHECKLIST (WHAT IS ALREADY DONE)**

### **Frontend Infrastructure**

* \[x\] Vite \+ React \+ TS initial setup.  
* \[x\] Tailwind CSS v4 configured.  
* \[x\] UI Layout Shell implemented (Sidebar, Topbar, App routing).  
* \[x\] Supabase client initialized (src/config/supabase.ts).

### **Views (UI Mockups completed)**

* \[x\] **Movements Page:** UI for daily packages table.  
* \[x\] **Statistics Page:** KPI cards and chart placeholders.  
* \[x\] **Clients Page:** Grid of client cards.  
* \[x\] **Zones Page:** Leaflet/OpenStreetMap integration with interactive markers and no API keys.  
* \[x\] **Auth Page:** Complex UI handling Login, Register Company (Admin), and Register Employee via join\_code.

### **Backend Status**

* \[x\] SQL Schema completely deployed in Supabase (Entities correctly related via company\_id).

## **5\. ROADMAP: NEXT STEPS FOR THE AI (WHAT TO BUILD NEXT)**

**Phase 1: Security & RLS (Completed)**

* \[x\] Finalize and apply robust RLS policies in Supabase to enforce multi-tenancy based on the existing schema.

**Phase 2: Auth Connection**

* \[x\] Connect the Auth.tsx UI to the real supabase.auth methods.  
* \[x\] Implement "Register Company": Create Auth user \-\> call transactional `register_company` RPC \-\> create active admin profile.  
* \[x\] Implement "Register Employee": Create Auth user \-\> call transactional `register_employee` RPC with join\_code \-\> create pending employee profile.  
* \[x\] Implement robust Route Protection based on session and profile status, including pending-account and onboarding-recovery screens.

**Phase 3: Real CRUD Operations**

* \[x\] Wire up Movements.tsx to the shipments table with tenant-safe list, search, status filters, KPIs, and create/edit/delete flows using clients and optional zones.  
* \[x\] Wire up Clients.tsx to the clients table with admin-facing list, search, create, edit, and delete flows, supporting company/individual records and optional identification/contact fields.  
* \[x\] Sync Zones.tsx with the zones table, including admin-only create/edit/delete, Argentina-only OpenStreetMap city search and exact coordinate selection, individual cities, groups with child cities/custom points, colored markers, search, and map focus controls.
* \[x\] Automatically resolve each shipment destination to a configured group or individual city, creating a tenant-owned individual city when no coverage exists.
* \[x\] Store a selectable operational date on each shipment, defaulting new movement forms to the user's current local day.

> **Roadmap status:** Every item from Phase 4 onward is proposed work and is not deployed unless its checkbox is explicitly marked complete in a later handover update.

**Phase 4: Company Members, Approval Flow & In-App Notifications (Next Priority)**

**Goal:** Complete the employee onboarding path so company administrators can see, accept, reject, suspend, and reactivate membership requests without using the Supabase dashboard.

> **Completed and validated on 2026-08-26:** migration `202608260001_membership_notifications.sql`, Team page, Topbar notification center, audited membership RPCs, and Realtime access refresh were applied and validated with the live Supabase project.

* \[x\] Add an admin-facing **Team / Members** page with tabs for pending, active, suspended, and rejected users.
* \[x\] Show a notification badge in the Topbar when a new employee requests access to the company.
* \[x\] Add an in-app notification center with read/unread state, creation date, destination link, and notification type.
* \[x\] Implement tenant-safe transactional RPCs for reviewing requests, suspending employees, and reactivating access.
* \[x\] Extend profile status safely beyond `pending` / `active` to support `rejected` and `suspended`. Rejected profiles remain linked to the company and may be reactivated by an admin instead of resubmitting.
* \[x\] Prevent company administrators from being suspended, demoted, or removed through employee-management RPCs.
* \[x\] Build the employee experience: employees see only allowed navigation items and actions, while pending/suspended/rejected accounts receive a specific status screen.
* \[x\] Notify the requesting employee in-app when the request is accepted or rejected. Realtime refreshes access immediately, while database state remains the source of truth.

**Suggested data model:**

* `notifications`: `id`, `company_id`, optional `recipient_profile_id`, `type`, `title`, `body`, `entity_type`, `entity_id`, `read_at`, `created_at`.
* Continue using `profiles` as the current membership record for the first version. Introduce a separate `company_memberships` table only if multiple-company membership becomes a real requirement.

**Acceptance criteria:**

* A pending employee cannot access tenant operational data.
* An administrator sees the request without reloading the Supabase dashboard and can accept or reject it from the app.
* Acceptance immediately unlocks the employee view; rejection/suspension immediately removes operational access.
* Every membership decision is authorized by RLS/RPC checks and recorded in an audit trail.

**Phase 5: Statistics V1 (Start Using the Existing Statistics Tab)**

**Goal:** Replace chart placeholders with useful operational information based on the shipment data that already exists.

> **Completed and validated on 2026-08-26:** migration `202608260002_operational_statistics.sql`, indexed aggregation/filter RPCs, global filters, operational KPIs, charts, rankings, previous-period comparisons, filtered navigation to Movements, UI states, and paginated CSV export were validated with live test data.

* \[x\] Add global filters for date range, status, zone/group, individual city, and client.
* \[x\] Implement real KPI cards: total movements, pending, in transit, delivered, incidents, delivery rate, and average daily volume.
* \[x\] Implement a daily movement trend chart and status distribution chart. Daily grouping is the V1 behavior; weekly aggregation can be added later if real usage requires it.
* \[x\] Add rankings for busiest zones, destination cities, and clients.
* \[x\] Allow users to click a KPI, trend day, status segment, or ranking to open the filtered movements view.
* \[x\] Include clear empty, loading, and error states and compare the selected period with the previous equivalent period.
* \[x\] Add paginated CSV export after the on-screen calculations were verified against live test data.

**Technical direction:**

* Prefer tenant-safe SQL views or aggregation RPCs over downloading every shipment and calculating all statistics in the browser.
* Use `shipment_date` for operational reporting; do not group by browser timestamps.
* Keep financial KPIs out of V1 until the economic engine in Phase 8 produces versioned and auditable amounts.

**Acceptance criteria:**

* Every KPI reconciles with the movements list for the same filters.
* Filters are shareable between all statistics components and reset predictably.
* An employee without future `statistics.view` permission cannot query the underlying statistics RPCs.

**Phase 6: Custom Roles & Fine-Grained Employee Permissions**

**Goal:** Replace the single generic employee capability set with company-defined roles and permissions while preserving an immutable owner/admin safety boundary.

> **Completed and validated on 2026-08-26:** migration `202608260003_custom_roles_permissions.sql`, protected administrator access, default employee-role backfill, permission-aware RLS/RPCs, the Roles and permissions page, employee role assignment, and permission-driven navigation/actions were applied and validated with the live Supabase project.

* \[x\] Add a **Roles and permissions** settings page where admins can create, clone, rename, and deactivate custom roles.
* \[x\] Define a stable permission catalog instead of free-text permissions. Initial keys should include:
  * `shipments.view`, `shipments.create`, `shipments.update`, `shipments.delete`.
  * `clients.view`, `clients.manage`.
  * `zones.view`, `zones.manage`.
  * `statistics.view`, `statistics.export`.
  * `members.view`, `members.review`, `members.manage_roles`.
  * `settings.view`, `settings.manage`, `pricing.view`, `pricing.manage`.
* \[x\] Assign one role to each active employee and show an effective-permissions preview before saving.
* \[x\] Update Sidebar/routes/buttons from effective permissions for usability, but enforce the same permissions in RLS and RPCs.
* \[x\] Introduce an `owner` or protected system-admin concept that custom roles cannot override.
* \[x\] Keep role-based permissions as the first implementation; exceptional per-user overrides remain intentionally deferred until real usage proves they are necessary.

**Suggested data model:**

* `company_roles`: tenant-owned role definitions with `name`, `description`, `is_system`, and `is_active`.
* `permissions`: global immutable catalog of known permission keys.
* `company_role_permissions`: many-to-many role/permission assignments.
* Add `role_id` to the membership/profile model through a staged migration that preserves current admins and employees.
* Add a database helper such as `app_private.has_permission(target_company_id, permission_key)` for RLS and RPC checks.

**Acceptance criteria:**

* Hiding a button is never the only security control.
* Permission changes take effect on the next query/session refresh without requiring code changes per company.
* System owner/admin access cannot be accidentally removed by a malformed custom role.

**Phase 7: Company, User, Web & Visual Settings**

**Goal:** Make LogisPro configurable per company and comfortable per user without weakening the shared design system.

> **Completed and validated on 2026-08-27:** migration `202608270001_company_user_settings.sql`, the Settings page, audited company and personal settings RPCs, private logo/avatar Storage policies, CSS-variable branding, dark/system themes, density/sidebar/default-page preferences, notification preferences, configurable map defaults, unified pending-changes save bar, and dark-mode compatibility were validated with the live project.

* \[x\] Add company settings for display name, logo, contact data, default timezone, locale, currency, date format, and default map center/zoom.
* \[x\] Add visual settings for primary/accent colors, light/dark/system theme, compact/comfortable table density, and optional sidebar collapse behavior.
* \[x\] Add personal settings for full name, avatar, theme preference, notification preferences, and default landing page.
* \[x\] Store logos/avatars in private or appropriately scoped Supabase Storage buckets with explicit policies.
* \[x\] Apply tenant branding through validated CSS variables; do not construct arbitrary Tailwind class names from database values.
* \[x\] Add a live preview and a restore-defaults action before persisting visual changes.

**Suggested data model:**

* `company_settings`: one row per company for operational defaults and branding.
* `user_preferences`: one row per profile for personal UI and notification preferences.
* Keep secrets and service credentials outside these tables and outside browser-readable environment variables.

**Phase 8: Economic Values, Rate Cards & Custom Pricing Formulas**

**Goal:** Introduce configurable economic rules that can calculate shipment prices, costs, surcharges, discounts, and commissions according to company, client, zone, and shipment characteristics.

> **Phase 8.1 validated on 2026-08-27:** migration `202608270002_pricing_engine_foundation.sql` and the Values economic page add the initial concept catalog, versioned draft/published rate cards, fixed/percentage/safe formula-tree rules, client/zone/destination scopes, basic operational conditions, concept snapshots, audited publication, and an explainable simulator.

> **Phase 8.1 publication follow-up prepared locally:** migration `202608270003_rate_card_version_succession.sql` completes the normal v1 → v2 workflow. Publishing a successor closes the preceding version on the previous day, or retires it when both begin on the same day, while future/ambiguous overlaps remain protected.

> **Phase 8.2 validated on 2026-08-27:** migration `202608270004_shipment_pricing_snapshots.sql` connects published lists to movement creation. Pricing remains optional, previews use the same database engine as final saves, operational inputs are stored on the movement, each calculation and line item is append-only, current totals appear to users with `pricing.view`, and priced movements are protected from hard deletion.

> **Phase 8.3 validated on 2026-08-27:** migration `202608270005_shipment_pricing_history_adjustments.sql` adds a movement-level economic history UI and tenant-safe RPCs for inspecting every revision. Users with `pricing.manage` can append a concept-based manual charge, discount, cost, or commission with a required reason; the actor and audit event are retained, adjustments carry forward through later movement recalculations, and no prior snapshot is modified. The migration also acquires its DDL locks in operational read order to avoid PostgREST deadlocks.

> **Phase 8.4 validated on 2026-08-27:** migration `202608270006_pricing_taxes.sql` adds versioned tax behavior (`none`, `included`, `added`) to charge rules, configurable labels/rates, net/tax/gross simulator explanations, immutable tax metadata on shipment lines, calculation-level included/added tax totals, and tax-aware movement previews/history. Existing snapshots are backfilled as untaxed. The rule editor also exposes cumulative versus exclusive execution.

> **Phase 8.5 validated on 2026-08-27:** migration `202608270007_advanced_pricing_rules.sql` expands the safe formula catalog with accumulated base price and numeric urgency/weekend/client-type flags, and adds server-derived client-type and zone-type conditions. The editor exposes all existing quantitative thresholds, safe binary operators, and multiple client/zone/destination selections while retaining the existing AND-between-types / OR-within-type scope semantics.

* \[x\] Start with a catalog of economic concepts: base delivery price, zone surcharge, client discount, insurance, handling, urgency, weight/volume, failed-delivery cost, fuel adjustment, and driver/employee commission.
* \[x\] Support effective date ranges, priority, currency, minimum/maximum amount, percentage/fixed values, cumulative/exclusive behavior, and tax inclusion.
* \[x\] Scope rules globally or to selected clients, zone groups, and individual cities in the current operational model. Future service/package scopes are tracked as a Phase 10 model extension instead of leaving Phase 8 apparently incomplete.
* \[x\] Build a rate-card editor and a **price simulator** that explains every applied rule before an admin activates it.
* \[x\] Support safe custom formulas based on the current explicit variable catalog: base price, quantity, weight, volume, distance, declared value, urgency, weekend, zone conditions, and client category. Holiday and future service/package variables are tracked as Phase 10 extensions because they require new operational entities.
* \[x\] Never execute administrator-provided JavaScript, SQL, or unrestricted expressions. Use a validated expression tree/DSL with allowed operators and variables.
* \[x\] Version and publish pricing configurations. Priced shipments retain append-only snapshots of the rule version, inputs, explainable line items, discounts, costs, commissions, and final customer total used at calculation time. Phase 8.4 extends the same immutable contract to tax metadata and totals.
* \[x\] Use PostgreSQL `numeric` for money and an ISO 4217 currency code; never use floating-point columns for economic amounts.
* \[x\] Add manual adjustments only with permission, reason, author, timestamp, and audit history.

**Suggested data model:**

* `economic_concepts`: company-defined charge/discount/cost concepts.
* `rate_cards` and `rate_card_versions`: draft/published/versioned pricing configurations.
* `pricing_rules`: conditions, priority, calculation type, validated formula representation, and effective dates.
* `pricing_rule_scopes`: links rules to clients, zones, cities, or future entity types without duplicating formulas.
* `shipment_charges`: immutable calculated line items and manual adjustments associated with a shipment.
* Future shipment inputs may include `package_count`, `weight_kg`, `volume_m3`, `declared_value`, `service_type`, `distance_km`, and urgency flags.

**Acceptance criteria:**

* The simulator and final shipment calculation produce identical results for the same version and inputs.
* Changing a rate never changes historical shipment totals.
* Every monetary total can be explained as a list of applied concepts and rules.
* Users without `pricing.manage` cannot modify or publish rate cards, even through direct API calls.

**Phase 9: Statistics V2, Financial Analytics & Reports**

**Goal:** Extend operational statistics with the trusted economic snapshots created by Phase 8.

> **Phase 9.1 validated on 2026-08-27:** migration `202608270008_financial_statistics.sql` adds a permission-aware financial statistics RPC over each movement's immutable current pricing snapshot. The Statistics page shows valuation coverage, estimated revenue, internal cost plus commissions, estimated margin, average ticket, discounts, taxes, prior-period comparisons, and profitability rankings by client/zone/city. Every aggregate is separated by ISO currency, and the interface explicitly distinguishes these estimates from billing, outstanding balances, and collections.

> **Phase 9.2 validated on 2026-08-27:** migration `202608270009_pricing_profitability_insights.sql` adds rate-card/version profitability comparisons and prioritized current-snapshot alerts for negative or sub-10% margins. The advanced panel remains isolated from the Phase 9.1 request so a comparison failure does not hide the trusted base financial KPIs. Results require both `statistics.view` and `pricing.view`, honor all dashboard filters, and remain separated by currency.

> **Phase 9.3 validated on 2026-08-27:** migration `202608270010_financial_statistics_export.sql` adds a paginated, permission-aware financial export over immutable current snapshots. The Statistics page can download a UTF-8 CSV with movement identity, list/version, currency, estimated revenue, costs, commissions, margin, taxes, and calculation timestamp. PostgreSQL requires both `statistics.export` and `pricing.view`; the browser escapes spreadsheet-formula prefixes in text fields. Scheduled delivery remains intentionally deferred until a real scheduler and delivery channel exist.

* \[x\] Add snapshot-based estimated revenue, operational cost, margin, average ticket, discounts, taxes, and profitability by client/zone/city. Outstanding/collected amounts require real accounting records and are now explicitly assigned to Phase 10.4.
* \[x\] Keep estimated revenue and costs visibly separated from billing and collections by not inventing absent accounting states. Phase 10.4 adds real settlement/payment records before those states enter statistics.
* \[x\] Add comparisons by rate-card version and alerts for negative or unusually low margins. Phase 9.2 uses a clearly disclosed initial low-margin threshold of 10%.
* \[x\] Add permission-aware export-ready financial detail. Unattended scheduling/delivery remains a conditional Phase 10.6 integration because no truthful scheduler/delivery channel exists yet.
* \[ \] Conditional optimization, not a Phase 9 completion blocker: add materialized views or scheduled aggregates only when measured dataset size proves normal indexed queries insufficient.

**Phase 10: Mobile Operations, Weekly Settlement & Automation**

**Goal:** Turn the secure pricing and analytics foundation into the fastest daily workflow for self-managed delivery groups: capture a package once, classify and assign it with minimal typing, preserve delivery evidence, close the week, share an exact summary, and register collections without reconstructing information manually.

> **Phase 10.1 prepared locally on 2026-08-27:** migration `202608270011_company_holiday_calendar.sql` introduces a tenant-owned, permission-aware, audited company holiday catalog. Managers can create, edit, activate, and deactivate dates from the Values page, while viewers can inspect the selected year. Pricing evaluation is intentionally connected in the next increment so the simulator and final movement calculation adopt holiday behavior atomically.

> **Cross-cutting map runtime validated on 2026-09-04; compatibility migration pending explicit deployment confirmation:** Mapbox runtime code, token configuration, and packages were removed. Leaflet/React-Leaflet now render standard attributed OpenStreetMap tiles, and city search uses explicit-submit, cached, one-request-per-second Nominatim calls. Migration `202609040001_openstreetmap_geocoding_transition.sql` preserves destination resolution across historical provider IDs without rewriting stored records. Legacy SQL names remain solely for deployed-schema compatibility.

### **Competitive response and product position**

The observed competitor validates demand for five highly visible workflows. LogisPro must cover them without weakening its stronger tenant, permission, pricing, tax, and profitability foundation.

| User promise | Current coverage | Planned LogisPro response |
| --- | --- | --- |
| Create a package from one photo | Not implemented | Phase 10.2 mobile express intake with private photo storage, scan/OCR assistance, generated identity, confirmation, and retry-safe creation |
| Scan many packages from one sender continuously | Not implemented | Phase 10.3 recoverable batch intake with shared defaults, duplicate detection, running totals, and atomic completion |
| Weekly history grouped by sender | Partial: filters and statistics exist, but not a weekly operational ledger | Phase 10.4 weekly client/sender close built from immutable shipment calculations |
| Send photos and exact total by PDF or WhatsApp | Not implemented | Phase 10.4 frozen summary PDF plus user-triggered native share/WhatsApp handoff |
| Mark who paid each week | Deliberately absent: estimates are not currently presented as collections | Phase 10.4 explicit settlement, payment, and allocation records with partial-payment support and audit history |

LogisPro's differentiator is the complete and explainable loop, not a copy of isolated competitor screens:

`express intake → automatic classification/pricing → balanced assignment → delivery evidence → weekly settlement → collection/member reconciliation`

### **Phase 10.1: Holiday-Aware Pricing (Finish Current Increment)**

* \[ \] Apply and validate `202608270011_company_holiday_calendar.sql` in the live project.
* \[ \] Add a safe `holiday` condition and numeric `holiday_flag` formula variable derived by PostgreSQL from company-owned active dates.
* \[ \] Make the Values simulator and final movement calculation derive the flag from the same shipment date and company calendar; the browser must not be the authority.
* \[ \] Verify ordinary days, active/inactive holidays, draft simulation, final pricing snapshots, permissions, and dark-mode states.

This increment should be completed cleanly, but it must not delay the competitive P0 intake and weekly-close loop with additional pricing features.

### **Phase 10.2 (P0): Mobile Express Intake From Photo or Scan**

* \[ \] Build a one-handed, mobile-first intake screen available from the primary navigation and a persistent quick action.
* \[ \] Let the operator take/upload one package photo, scan an existing barcode/QR when present, or create an internal unique code automatically when none exists.
* \[ \] Store originals and thumbnails in a private tenant-scoped Supabase Storage bucket with explicit policies, file limits, content validation, and retention rules.
* \[ \] Use barcode/OCR only to suggest tracking, sender, or destination fields. Show confidence and require operator confirmation for ambiguous data; never silently create operational truth from OCR.
* \[ \] Reuse session defaults such as client/sender, date, rate card, service/package type, and destination so the normal path requires minimal typing.
* \[ \] Make creation idempotent and retry-safe. Detect repeated codes and file hashes, show the suspected duplicate, and preserve an interrupted local draft.

**Acceptance criteria:** a normal package can be registered and ready for the next capture in seconds; network retries never create duplicates; the operator always sees what was recognized versus manually confirmed; photos remain private; and permission/RLS checks protect every write.

### **Phase 10.3 (P0): Continuous Batch Intake by Client/Sender**

* \[ \] Introduce an `intake_batch` with client/sender, operational date, list, and common defaults selected once.
* \[ \] Allow uninterrupted photo/scan capture with a running accepted/duplicate/error count, package count, and estimated total.
* \[ \] Support pause, resume, review, correction, and atomic finalization; partially uploaded or invalid rows must not disappear.
* \[ \] Keep the current client entity as the sender/account owner initially. Add a separate sender entity only when a real workflow proves that one billed client needs multiple operational senders.
* \[ \] Add CSV/XLSX import to the same batch validation pipeline later, rather than creating a second inconsistent bulk path.

**Acceptance criteria:** an operator can process a real sack/stack without reopening a form, duplicated scans are blocked visibly, totals reconcile with finalized shipments, and a lost connection or browser reload can recover the batch.

### **Phase 10.4 (P0): Weekly Close, Shareable Summary & Collections**

* \[ \] Add weekly history grouped by client/sender with clear included/excluded movements and per-currency totals.
* \[ \] Create immutable settlement batches and line references that freeze the selected movement calculation snapshots at close time. Later repricing must not rewrite an issued weekly summary.
* \[ \] Generate a branded PDF summary containing movement identity, relevant photos/evidence, line totals, adjustments, taxes, and a reconciled final amount.
* \[ \] Add a native share action and prefilled WhatsApp handoff initiated by the user. Automated outbound WhatsApp requires a later server-side provider, consent, templates, credentials, retries, and cost disclosure.
* \[ \] Model payments separately from estimates and documents: record date, amount, currency, method, reference, actor, and allocations to one or more settlements.
* \[ \] Support unpaid, partially paid, paid, and voided/reversed states derived from immutable payment allocations; reject over-allocation and audit every correction.
* \[ \] Do not call a summary an invoice or an estimated amount collected unless a real billing/collection record supports that state.

**Suggested data model:** `shipment_media`, `intake_batches`, `intake_batch_items`, `settlement_batches`, `settlement_items`, `payments`, and `payment_allocations`, all tenant-owned and protected by RLS/RPC permissions.

**Acceptance criteria:** PDF and UI totals exactly match the frozen settlement; each payment state is reproducible from allocations; partial payments work; different currencies are never summed together; and the sender can receive the summary without requiring an account.

### **Phase 10.5 (P1): Automatic Distribution & Driver Workflow**

* \[ \] Add drivers/members, availability, capacity, vehicles where needed, route manifests, assignments, pickup/delivery windows, failed attempts, incidents, and proof of delivery.
* \[ \] Provide a rule-based assignment preview using zone, proximity, workload, urgency, capacity, and member availability, with a clear explanation and manual override before confirmation.
* \[ \] Build a mobile **My route / My packages** view with scan-to-accept, status changes, navigation handoff, delivery photo/signature, and exception reasons.
* \[ \] Reconcile driver commissions/earnings from the existing immutable pricing concepts into the same weekly close without confusing company costs with customer collections.

**Acceptance criteria:** automatic distribution is deterministic and reviewable, never silently loses an assignment, respects permissions/capacity, and can be manually corrected with an audit event.

### **Phase 10.6 (P1/P2): Integrations and Expansion After Pilot Evidence**

* \[ \] Mercado Libre/ecommerce imports through scoped APIs or files with idempotency keys, preview, deduplication, and retry logs.
* \[ \] Client self-service portal for scoped tracking, documents, account statements, and optional shipment creation.
* \[ \] Configurable SLA, deadline calculation, breach alerts, and on-time-delivery statistics.
* \[ \] Optional email/WhatsApp automation through server-side providers and explicit company/user preferences.
* \[ \] Audit center, labels/manifests/POD documents, lifecycle/retention controls, backups, and safe company offboarding.

### **Phase 10 Product Quality Gates**

* Test every P0 flow on representative low/mid-range Android phones, narrow viewports, intermittent connections, touch input, and both light/dark themes before calling it validated.
* Track intake completion time, corrections, suspected duplicates, batch recovery, weekly-close reconciliation failures, and share failures without storing photo contents or sensitive labels in telemetry.
* Automations must provide a preview or explanation, an explicit confirmation at financially/operationally consequential points, and a recoverable manual override.
* Every retryable mutation needs an idempotency strategy; every background/upload state needs visible progress, failure, and resume behavior.
* No P0 feature is complete with frontend-only permission checks, inaccessible contrast/focus states, unexplained totals, or untested tenant boundaries.

## **5\.1 IMPLEMENTATION ORDER & DEPENDENCIES**

Recommended execution order:

1. Finish and live-validate Phase 10.1 holiday-aware pricing as the current bounded increment.
2. Build Phase 10.2 express mobile intake and validate it with actual phones and representative package photos/codes.
3. Extend the same safe intake pipeline into Phase 10.3 continuous batches; do not build a disconnected bulk interface.
4. Complete Phase 10.4 weekly settlement, PDF/share, and truthful payment allocation. This closes the competitor-visible operational loop.
5. Add Phase 10.5 explainable automatic distribution, driver mobile execution, proof of delivery, and member reconciliation.
6. Choose Phase 10.6 integrations from pilot evidence. Mercado Libre import is preferred when credentials/API feasibility are confirmed; portal and automated messaging must not precede the core operator workflow.

Phases 1 through 9.3 are complete and validated. The active product phase is **10.1**, while the OpenStreetMap change is cross-cutting infrastructure work. Until the P0 loop is validated, avoid diverting effort into generic fleet breadth, unattended messaging, or a broad client portal.

## **5\.2 CROSS-CUTTING ENGINEERING REQUIREMENTS**

* Every new tenant-owned table must include `company_id`, RLS, explicit grants, tenant-safe foreign-key validation, and indexes for its primary filters.
* Mutations spanning multiple related tables must use transactional RPCs rather than a sequence of browser writes that can partially succeed.
* Add an `audit_events` strategy before membership administration and pricing become production-critical.
* Add database migration notes, rollback/recovery considerations, and post-deployment validation for every phase.
* Add automated tests in layers: pure formula/unit tests, component interaction tests, Supabase/RLS integration tests, and critical end-to-end flows.
* Use pagination/virtualization for growing lists and aggregation endpoints for dashboards.
* Prefer soft deactivation for referenced roles, clients, rate cards, and members; hard deletion must remain recoverable or blocked when historical relations exist.
* Treat notifications as informative signals, never as the source of authorization state.
* All dates used for reporting or pricing must have an explicit semantic (`date`, `timestamptz`, company timezone) and must not depend accidentally on browser/server timezone conversions.

## **6\. STRICT RULES FOR THE AI ASSISTANT**

1. **NO TAILWIND CONFIG FILES:** Use Tailwind v4 standards (@theme in CSS).  
2. **STRICT TYPESCRIPT:** Define proper interfaces in src/types/index.ts. No any.  
3. **RLS RELIANCE:** Never pass company\_id directly from the frontend in SELECT queries. Let RLS handle it.  
4. **MAPS:** Use Leaflet/React-Leaflet with attributed OpenStreetMap tiles and explicit, rate-limited geocoding. Do not add provider keys or autocomplete requests.
5. **PERMISSIONS:** UI visibility is not a security boundary. Enforce every custom permission through RLS and/or tenant-safe RPCs.
6. **MONEY:** Use `numeric` plus an explicit currency code and immutable calculation snapshots. Never use floating point for money.
7. **CUSTOM FORMULAS:** Never evaluate arbitrary JavaScript/SQL supplied by users. Formulas must use a validated and versioned safe expression model.
8. **AUDITABILITY:** Membership, permission, pricing, and manual economic changes must record actor, timestamp, tenant, action, and affected entity.

*End of Context Document.*

*AI: Acknowledge this context and continue with the earliest incomplete item in the recommended execution order unless the user explicitly changes priority.*

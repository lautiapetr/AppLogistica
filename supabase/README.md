# Supabase security deployment

The migrations in `migrations/` contain the security baseline and subsequent
role restrictions for the schema documented in `HandoverForCodex.md`.

## Before applying it

1. Back up the database or take a Supabase branch snapshot.
2. Confirm the five tables and documented columns exist in the `public` schema.
3. Check for invitation codes that collide after trimming and uppercasing:

   ```sql
   select upper(btrim(join_code)) as normalized_code, count(*)
   from public.companies
   group by upper(btrim(join_code))
   having count(*) > 1;
   ```

4. Review legacy profile values before validating the new constraints:

   ```sql
   select distinct role, status from public.profiles;
   ```

The migration intentionally removes all prior policies from `companies`,
`profiles`, `clients`, `zones`, and `shipments`. This is necessary because
PostgreSQL permissive policies are combined with `OR`.

## Apply

Apply migrations through the Supabase SQL Editor in filename order. Each script
is transactional: an error rolls back that entire migration.

- `202608250001_secure_multi_tenant_rls.sql`: tenant security baseline.
- `202608250002_clients_admin_write.sql`: restricts client writes to active
  company admins while retaining tenant-wide read access.
- `202608250003_expand_client_details.sql`: adds company/individual client types
  and optional identification and contact fields.
- `202608250004_shipments_integrity.sql`: defines shipment states and enforces
  tenant-scoped tracking-number uniqueness.
- `202608250005_zones_coordinates_admin.sql`: persists map coordinates/colors
  and restricts zone configuration to active admins.
- `202608250006_zone_groups_and_destination_resolution.sql`: adds individual
  cities, groups with child cities/custom points, provider-neutral destination metadata,
  and tenant-safe automatic destination resolution.
- `202608250007_shipments_operation_date.sql`: adds the selectable operational
  date to shipments and updates the transactional shipment RPC.
- `202608260001_membership_notifications.sql`: adds employee approval,
  rejection/suspension states, persistent in-app notifications, membership
  audit events, secure review RPCs, and Realtime publication.
- `202608260002_operational_statistics.sql`: adds indexed, tenant-safe
  operational statistics and dashboard filter-option RPCs.
- `202608260003_custom_roles_permissions.sql`: adds the immutable permission
  catalog, company-defined employee roles, protected administrator access,
  role assignment and audit records, plus permission-aware RLS and RPCs.
- `202608270001_company_user_settings.sql`: adds tenant branding and operational
  defaults, personal UI/notification preferences, audited settings RPCs, and
  private company-logo/profile-avatar Storage buckets with explicit policies.
- `202608270002_pricing_engine_foundation.sql`: adds tenant-owned economic
  concepts, versioned rate cards, fixed/percentage/safe-formula rules, scoped
  conditions, audited publication, and an explainable pricing simulator.
- `202608270003_rate_card_version_succession.sql`: completes rate-card
  publication by closing or retiring the preceding version automatically while
  continuing to reject ambiguous overlaps with future scheduled versions.
- `202608270004_shipment_pricing_snapshots.sql`: connects published rate cards
  to movement creation, adds optional package/weight/volume/value/distance
  inputs, and stores append-only calculation snapshots and line items.
- `202608270005_shipment_pricing_history_adjustments.sql`: exposes the complete
  calculation history and adds reasoned, actor-attributed manual adjustments by
  appending a new snapshot instead of mutating an existing one.
- `202609040001_openstreetmap_geocoding_transition.sql`: makes destination
  resolution compatible with OpenStreetMap identifiers while preserving
  historical provider IDs and deployed SQL signatures.

The local project does not currently include the Supabase CLI configuration, so
these migrations cannot be pushed with `supabase db push` yet.

City search uses OpenStreetMap Nominatim only after an explicit user action;
there is no autocomplete. Results are cached locally for 30 days and requests
are limited to one per second. Leaflet renders the standard OpenStreetMap tiles
with visible attribution. No API key is required. Database fields that still
contain `mapbox` in their name are legacy compatibility fields and now store a
provider-neutral external place identifier.

## What it enforces

- Only active members can access tenant data.
- Tenant identity comes from `auth.uid()` and `profiles`, not a browser filter.
- Pending employees can read only their own profile and cannot access company
  data until approved.
- Administrators retain protected owner-level access; employee access is
  derived from an active company role and a stable permission catalog.
- Role and permission changes are audited, and an employee can never modify or
  demote an administrator through membership or role-management endpoints.
- Users cannot promote themselves or move a profile to another company.
- Shipment client/zone references must belong to the same company.
- A destination city resolves first to an explicitly configured group, then to
  an individual city, and otherwise creates an individual city for that tenant.
- Only admins configure groups and their locations; active members can trigger
  automatic city creation while registering a shipment.
- Shipment inserts/updates use one transactional RPC, so destination resolution
  cannot be bypassed and failed shipments do not leave orphan cities.
- Pending, rejected, and suspended employees cannot access operational tenant
  data; active admins review employee access through audited RPCs.
- Membership notifications are visible only to their recipient, while
  membership audit events are visible only to active company admins.
- Registration uses transactional RPCs and no longer needs direct browser INSERT
  access to `companies` or `profiles`.
- Company settings can be changed only with `settings.manage`; every active user
  may save only their own preferences and avatar.
- Logo and avatar objects use deterministic tenant/profile paths, private
  buckets, a 2 MB limit, and PNG/JPEG/WebP MIME restrictions.

## Phase 2 frontend integration

Implemented in `src/services/auth.ts`: after `supabase.auth.signUp` creates an
authenticated session, the app calls one of these RPCs instead of inserting
into tables directly:

```ts
await supabase.rpc('register_company', {
  company_name: companyName,
  full_name: fullName,
});

await supabase.rpc('register_employee', {
  invitation_code: joinCode,
  full_name: fullName,
});
```

Signup also stores the validated onboarding fields in Supabase Auth user
metadata. If **Confirm email** is enabled later and `signUp` returns no session,
the same RPC provisioning is resumed safely on the user's first confirmed
login. No table policy needs to be weakened.

## Post-deployment validation

After applying the migration, run Supabase's database linter and test with two
companies plus one pending employee. At minimum verify:

1. An active user cannot read, insert, update, or delete another company's rows.
2. A forged `company_id` is rejected on every tenant-owned insert/update.
3. A pending employee sees only their own profile.
4. An employee cannot change `role`, `status`, or `company_id`.
5. An admin can activate an employee in the same company but not another one.
6. A shipment cannot reference another tenant's client or zone.
7. A new employee request creates an unread notification for each active admin.
8. Approving/rejecting a request updates the employee screen through Realtime.
9. Suspending an active employee immediately removes operational RLS access.
10. A non-admin cannot review requests, manage access, or read another user's
    notifications.
11. Statistics totals reconcile with the movements list for the same date and
    filters.
12. A forged client/zone UUID is rejected by the statistics RPC and a range
    longer than 366 days is rejected.
13. An employee sees only modules granted to their role; direct table/RPC calls
    without the matching permission are rejected.
14. Removing a permission takes effect in database checks immediately and in
    the UI after the employee access state refreshes.
15. A custom role cannot alter an administrator, and a role with assigned
    employees cannot be deactivated until those employees are reassigned.
16. An admin can save company branding/defaults and receives an audit event;
    an employee with only `settings.view` cannot call that mutation RPC.
17. Each user can update only their own name, preferences, and avatar path.
18. Forged logo/avatar paths and unsupported or oversized images are rejected.
19. Theme, colors, density, sidebar behavior, default landing page, and map
    center survive a logout/login cycle.
20. A member cannot read or overwrite another company's logo or settings.
21. A user without `pricing.view` cannot read or simulate rate cards, and a
    user without `pricing.manage` cannot change concepts, drafts, or versions.
22. A draft accepts fixed, percentage, and allowed formula-tree rules, while
    unsupported variables/operators and forged client/zone scopes are rejected.
23. Publishing requires an active rule. A successor automatically closes the
    preceding published version on the previous day (or retires it when both
    begin on the same day); ambiguous overlaps with scheduled future versions
    remain blocked. Published rules cannot be edited through table/RPC calls.
24. Changing or deactivating an economic concept does not alter the concept
    snapshot or result of a previously published version.
25. Simulator totals reconcile with the returned line items for global,
    client, zone, destination, urgency, weekend, weight, and distance cases.
26. A movement can still be saved without a tariff; selecting a published rate
    card produces the same total in preview and in the saved movement summary.
27. Editing a priced movement appends a new calculation and never overwrites
    its previous snapshot or line items.
28. Publishing or changing a rate does not alter existing movement totals, and
    a movement with economic history cannot be hard-deleted.
29. A user with `pricing.view` can inspect every calculation revision and line
    item for a movement but cannot create an adjustment.
30. A user with `pricing.manage` can apply a positive charge, discount, cost, or
    commission adjustment only with an active concept and a required reason.
31. After an adjustment, the previous current calculation and its lines remain
    byte-for-byte unchanged while a new audited revision becomes current.
32. Editing and recalculating a movement carries its existing manual adjustment
    lines into the new revision instead of silently discarding them.

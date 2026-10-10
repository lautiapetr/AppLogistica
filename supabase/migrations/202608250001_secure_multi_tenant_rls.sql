-- LogisPro multi-tenant security baseline.
--
-- This migration intentionally replaces every existing policy on the five
-- application tables. PostgreSQL permissive policies are combined with OR, so
-- leaving an older, broader policy in place could bypass these restrictions.

begin;

create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

-- These helpers are SECURITY DEFINER to avoid recursive RLS evaluation while a
-- policy on profiles looks up the current user's tenant and role.
create or replace function app_private.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.company_id
  from public.profiles as profile
  where profile.id = (select auth.uid())
    and profile.status = 'active'
  limit 1
$$;

create or replace function app_private.is_active_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_company_id is not null
    and target_company_id = app_private.current_company_id()
$$;

create or replace function app_private.is_company_admin(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.company_id = target_company_id
      and profile.role = 'admin'
      and profile.status = 'active'
  )
$$;

revoke all on function app_private.current_company_id() from public, anon, authenticated;
revoke all on function app_private.is_active_company_member(uuid) from public, anon, authenticated;
revoke all on function app_private.is_company_admin(uuid) from public, anon, authenticated;

grant execute on function app_private.current_company_id() to authenticated;
grant execute on function app_private.is_active_company_member(uuid) to authenticated;
grant execute on function app_private.is_company_admin(uuid) to authenticated;

-- New tenant-owned rows can omit company_id. The database derives it from the
-- authenticated active profile, while the INSERT policies still reject a
-- caller that explicitly submits another tenant's UUID.
alter table public.clients
  alter column company_id set default app_private.current_company_id();
alter table public.zones
  alter column company_id set default app_private.current_company_id();
alter table public.shipments
  alter column company_id set default app_private.current_company_id();

-- Enforce the role/status vocabulary for new and modified profiles without
-- blocking deployment if legacy rows need cleanup first.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'profiles_role_logispro_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_logispro_check
      check (role in ('admin', 'employee')) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'profiles_status_logispro_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_status_logispro_check
      check (status in ('active', 'pending')) not valid;
  end if;
end
$$;

-- Invitation codes are bearer secrets. Normalize uniqueness so different
-- casing or surrounding whitespace cannot identify two companies.
create unique index if not exists companies_join_code_normalized_key
  on public.companies ((upper(btrim(join_code))));

-- Browser registration uses these transactional functions instead of direct
-- INSERT permissions on companies/profiles. They prevent partial provisioning
-- and prevent clients from choosing their own role, status, or company UUID.
create or replace function public.register_company(
  company_name text,
  full_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  new_company_id uuid;
  new_join_code text;
  attempt_number integer;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to register a company.';
  end if;

  company_name := btrim(company_name);
  full_name := btrim(full_name);

  if company_name is null or char_length(company_name) not between 2 and 120 then
    raise exception using
      errcode = '22023',
      message = 'Company name must contain between 2 and 120 characters.';
  end if;

  if full_name is null or char_length(full_name) not between 2 and 120 then
    raise exception using
      errcode = '22023',
      message = 'Full name must contain between 2 and 120 characters.';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = current_user_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'This user already has a company profile.';
  end if;

  for attempt_number in 1..10 loop
    new_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    begin
      insert into public.companies (name, join_code)
      values (company_name, new_join_code)
      returning id into new_company_id;

      exit;
    exception
      when unique_violation then
        if attempt_number = 10 then
          raise exception using
            errcode = '23505',
            message = 'Could not generate a unique invitation code.';
        end if;
    end;
  end loop;

  insert into public.profiles (id, company_id, full_name, role, status)
  values (current_user_id, new_company_id, full_name, 'admin', 'active');

  return jsonb_build_object(
    'company_id', new_company_id,
    'join_code', new_join_code
  );
end
$$;

create or replace function public.register_employee(
  invitation_code text,
  full_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_company_id uuid;
  normalized_code text := upper(btrim(invitation_code));
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to join a company.';
  end if;

  full_name := btrim(full_name);

  if full_name is null or char_length(full_name) not between 2 and 120 then
    raise exception using
      errcode = '22023',
      message = 'Full name must contain between 2 and 120 characters.';
  end if;

  if normalized_code is null or normalized_code = '' then
    raise exception using
      errcode = '22023',
      message = 'An invitation code is required.';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = current_user_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'This user already has a company profile.';
  end if;

  select company.id
  into target_company_id
  from public.companies as company
  where upper(btrim(company.join_code)) = normalized_code
  limit 1;

  if target_company_id is null then
    raise exception using
      errcode = '22023',
      message = 'The invitation code is invalid.';
  end if;

  insert into public.profiles (id, company_id, full_name, role, status)
  values (current_user_id, target_company_id, full_name, 'employee', 'pending');

  return jsonb_build_object('status', 'pending');
end
$$;

revoke all on function public.register_company(text, text) from public, anon, authenticated;
revoke all on function public.register_employee(text, text) from public, anon, authenticated;
grant execute on function public.register_company(text, text) to authenticated;
grant execute on function public.register_employee(text, text) to authenticated;

-- A user may edit only their own full_name. An active company admin may change
-- only an employee's status. RLS selects the rows; this trigger constrains the
-- columns so role/company escalation is impossible through a direct UPDATE.
create or replace function app_private.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  -- Internal maintenance and service-role operations have no end-user UID.
  if current_user_id is null then
    return new;
  end if;

  if old.id = current_user_id then
    new.full_name := btrim(new.full_name);

    if new.full_name is null or char_length(new.full_name) not between 2 and 120 then
      raise exception using
        errcode = '22023',
        message = 'Full name must contain between 2 and 120 characters.';
    end if;

    if (to_jsonb(new) - 'full_name' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'full_name' - 'updated_at') then
      raise exception using
        errcode = '42501',
        message = 'Users may only update their own full name.';
    end if;

    return new;
  end if;

  if app_private.is_company_admin(old.company_id) and old.role = 'employee' then
    if (to_jsonb(new) - 'status' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception using
        errcode = '42501',
        message = 'Admins may only update an employee status.';
    end if;

    return new;
  end if;

  raise exception using
    errcode = '42501',
    message = 'This profile cannot be updated by the current user.';
end
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
before update on public.profiles
for each row execute function app_private.guard_profile_update();

revoke all on function app_private.guard_profile_update() from public, anon, authenticated;

-- Keep company identity and invitation codes immutable from browser updates.
create or replace function app_private.guard_company_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  new.name := btrim(new.name);

  if new.name is null or char_length(new.name) not between 2 and 120 then
    raise exception using
      errcode = '22023',
      message = 'Company name must contain between 2 and 120 characters.';
  end if;

  if (to_jsonb(new) - 'name' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'name' - 'updated_at') then
    raise exception using
      errcode = '42501',
      message = 'Only the company name may be updated.';
  end if;

  return new;
end
$$;

drop trigger if exists guard_company_update on public.companies;
create trigger guard_company_update
before update on public.companies
for each row execute function app_private.guard_company_update();

revoke all on function app_private.guard_company_update() from public, anon, authenticated;

-- A shipment cannot point at a client or zone owned by another tenant, even if
-- a caller knows the foreign UUID. This closes a gap that a company_id-only RLS
-- policy cannot detect by itself.
create or replace function app_private.validate_shipment_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is not null and not exists (
    select 1
    from public.clients as client
    where client.id = new.client_id
      and client.company_id = new.company_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'The selected client does not belong to the shipment company.';
  end if;

  if new.zone_id is not null and not exists (
    select 1
    from public.zones as zone
    where zone.id = new.zone_id
      and zone.company_id = new.company_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'The selected zone does not belong to the shipment company.';
  end if;

  return new;
end
$$;

drop trigger if exists validate_shipment_tenant_links on public.shipments;
create trigger validate_shipment_tenant_links
before insert or update of company_id, client_id, zone_id on public.shipments
for each row execute function app_private.validate_shipment_tenant_links();

revoke all on function app_private.validate_shipment_tenant_links() from public, anon, authenticated;

-- Existing policies must be removed: multiple permissive policies are ORed.
do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('companies', 'profiles', 'clients', 'zones', 'shipments')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename
    );
  end loop;
end
$$;

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.zones enable row level security;
alter table public.shipments enable row level security;

alter table public.companies force row level security;
alter table public.profiles force row level security;
alter table public.clients force row level security;
alter table public.zones force row level security;
alter table public.shipments force row level security;

create policy companies_select_own
on public.companies
for select
to authenticated
using (app_private.is_active_company_member(id));

create policy companies_update_admin
on public.companies
for update
to authenticated
using (app_private.is_company_admin(id))
with check (app_private.is_company_admin(id));

create policy profiles_select_tenant
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or app_private.is_active_company_member(company_id)
);

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy profiles_update_admin
on public.profiles
for update
to authenticated
using (app_private.is_company_admin(company_id))
with check (app_private.is_company_admin(company_id));

create policy clients_select_tenant
on public.clients
for select
to authenticated
using (app_private.is_active_company_member(company_id));

create policy clients_insert_tenant
on public.clients
for insert
to authenticated
with check (app_private.is_active_company_member(company_id));

create policy clients_update_tenant
on public.clients
for update
to authenticated
using (app_private.is_active_company_member(company_id))
with check (app_private.is_active_company_member(company_id));

create policy clients_delete_tenant
on public.clients
for delete
to authenticated
using (app_private.is_active_company_member(company_id));

create policy zones_select_tenant
on public.zones
for select
to authenticated
using (app_private.is_active_company_member(company_id));

create policy zones_insert_tenant
on public.zones
for insert
to authenticated
with check (app_private.is_active_company_member(company_id));

create policy zones_update_tenant
on public.zones
for update
to authenticated
using (app_private.is_active_company_member(company_id))
with check (app_private.is_active_company_member(company_id));

create policy zones_delete_tenant
on public.zones
for delete
to authenticated
using (app_private.is_active_company_member(company_id));

create policy shipments_select_tenant
on public.shipments
for select
to authenticated
using (app_private.is_active_company_member(company_id));

create policy shipments_insert_tenant
on public.shipments
for insert
to authenticated
with check (app_private.is_active_company_member(company_id));

create policy shipments_update_tenant
on public.shipments
for update
to authenticated
using (app_private.is_active_company_member(company_id))
with check (app_private.is_active_company_member(company_id));

create policy shipments_delete_tenant
on public.shipments
for delete
to authenticated
using (app_private.is_active_company_member(company_id));

-- Explicit grants ensure that anon cannot bypass registration through table
-- endpoints. RLS remains the row-level boundary for authenticated CRUD.
revoke all on table public.companies from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.clients from anon, authenticated;
revoke all on table public.zones from anon, authenticated;
revoke all on table public.shipments from anon, authenticated;

grant select, update on table public.companies to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.clients to authenticated;
grant select, insert, update, delete on table public.zones to authenticated;
grant select, insert, update, delete on table public.shipments to authenticated;

grant usage, select on all sequences in schema public to authenticated;

commit;

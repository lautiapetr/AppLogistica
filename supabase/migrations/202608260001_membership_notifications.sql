-- Phase 4: employee membership review, persistent in-app notifications, and
-- an immutable audit trail for every membership status decision.

begin;

alter table public.profiles
  add column if not exists email text;

update public.profiles as profile
set email = auth_user.email
from auth.users as auth_user
where auth_user.id = profile.id
  and profile.email is distinct from auth_user.email;

alter table public.profiles
  drop constraint if exists profiles_status_logispro_check;

alter table public.profiles
  add constraint profiles_status_logispro_check
  check (status in ('active', 'pending', 'rejected', 'suspended'));

create or replace function app_private.set_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select auth_user.email
  into new.email
  from auth.users as auth_user
  where auth_user.id = new.id;

  return new;
end
$$;

drop trigger if exists set_profile_email on public.profiles;
create trigger set_profile_email
before insert on public.profiles
for each row execute function app_private.set_profile_email();

revoke all on function app_private.set_profile_email() from public, anon, authenticated;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  type varchar(60) not null,
  title varchar(160) not null,
  body text not null,
  entity_type varchar(60),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_type_logispro_check
    check (type in (
      'membership_request',
      'membership_approved',
      'membership_rejected',
      'membership_suspended',
      'membership_reactivated'
    )),
  constraint notifications_title_logispro_check
    check (char_length(btrim(title)) between 2 and 160),
  constraint notifications_body_logispro_check
    check (nullif(btrim(body), '') is not null)
);

create index notifications_recipient_unread_created_idx
  on public.notifications (recipient_profile_id, created_at desc)
  where read_at is null;

create index notifications_recipient_created_idx
  on public.notifications (recipient_profile_id, created_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action varchar(100) not null,
  entity_type varchar(60) not null,
  entity_id uuid,
  previous_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_company_created_idx
  on public.audit_events (company_id, created_at desc);

create or replace function app_private.notify_pending_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'employee' and new.status = 'pending' then
    insert into public.notifications (
      company_id,
      recipient_profile_id,
      type,
      title,
      body,
      entity_type,
      entity_id,
      metadata
    )
    select
      new.company_id,
      administrator.id,
      'membership_request',
      'Nueva solicitud de ingreso',
      new.full_name || ' quiere unirse a la empresa.',
      'profile',
      new.id,
      jsonb_build_object('employee_name', new.full_name)
    from public.profiles as administrator
    where administrator.company_id = new.company_id
      and administrator.role = 'admin'
      and administrator.status = 'active';
  end if;

  return new;
end
$$;

drop trigger if exists notify_pending_membership on public.profiles;
create trigger notify_pending_membership
after insert on public.profiles
for each row execute function app_private.notify_pending_membership();

create or replace function app_private.audit_membership_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_type text;
  notification_title text;
  notification_body text;
  audit_action text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'active' and old.status = 'pending' then
    notification_type := 'membership_approved';
    notification_title := 'Solicitud aprobada';
    notification_body := 'Tu ingreso a la empresa fue aprobado.';
    audit_action := 'membership.approved';
  elsif new.status = 'rejected' and old.status = 'pending' then
    notification_type := 'membership_rejected';
    notification_title := 'Solicitud rechazada';
    notification_body := 'Tu solicitud de ingreso fue rechazada por un administrador.';
    audit_action := 'membership.rejected';
  elsif new.status = 'suspended' and old.status = 'active' then
    notification_type := 'membership_suspended';
    notification_title := 'Acceso suspendido';
    notification_body := 'Tu acceso operativo a la empresa fue suspendido.';
    audit_action := 'membership.suspended';
  elsif new.status = 'active' and old.status in ('suspended', 'rejected') then
    notification_type := 'membership_reactivated';
    notification_title := 'Acceso habilitado';
    notification_body := 'Tu acceso operativo a la empresa fue habilitado nuevamente.';
    audit_action := 'membership.reactivated';
  else
    raise exception using
      errcode = '22023',
      message = 'This membership status transition is not supported.';
  end if;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where company_id = new.company_id
    and type = 'membership_request'
    and entity_type = 'profile'
    and entity_id = new.id;

  insert into public.notifications (
    company_id,
    recipient_profile_id,
    type,
    title,
    body,
    entity_type,
    entity_id
  ) values (
    new.company_id,
    new.id,
    notification_type,
    notification_title,
    notification_body,
    'profile',
    new.id
  );

  insert into public.audit_events (
    company_id,
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    previous_data,
    new_data
  ) values (
    new.company_id,
    auth.uid(),
    audit_action,
    'profile',
    new.id,
    jsonb_build_object('status', old.status),
    jsonb_build_object('status', new.status)
  );

  return new;
end
$$;

drop trigger if exists audit_membership_status_change on public.profiles;
create trigger audit_membership_status_change
after update of status on public.profiles
for each row execute function app_private.audit_membership_status_change();

revoke all on function app_private.notify_pending_membership() from public, anon, authenticated;
revoke all on function app_private.audit_membership_status_change() from public, anon, authenticated;

-- Backfill one unread request for pending employees created before this phase.
insert into public.notifications (
  company_id,
  recipient_profile_id,
  type,
  title,
  body,
  entity_type,
  entity_id,
  metadata
)
select
  employee.company_id,
  administrator.id,
  'membership_request',
  'Nueva solicitud de ingreso',
  employee.full_name || ' quiere unirse a la empresa.',
  'profile',
  employee.id,
  jsonb_build_object('employee_name', employee.full_name)
from public.profiles as employee
join public.profiles as administrator
  on administrator.company_id = employee.company_id
 and administrator.role = 'admin'
 and administrator.status = 'active'
where employee.role = 'employee'
  and employee.status = 'pending';

alter table public.notifications enable row level security;
alter table public.notifications force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

create policy notifications_select_recipient
on public.notifications
for select
to authenticated
using (recipient_profile_id = (select auth.uid()));

create policy audit_events_select_admin
on public.audit_events
for select
to authenticated
using (app_private.is_company_admin(company_id));

revoke all on table public.notifications from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;
grant select on table public.notifications to authenticated;
grant select on table public.audit_events to authenticated;

create or replace function public.review_membership_request(
  target_profile_id uuid,
  decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  reviewed_profile public.profiles%rowtype;
begin
  decision := lower(btrim(decision));

  if target_company_id is null
     or not app_private.is_company_admin(target_company_id) then
    raise exception using errcode = '42501', message = 'Only an active administrator can review membership requests.';
  end if;

  if decision not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'Decision must be approve or reject.';
  end if;

  update public.profiles
  set status = case decision when 'approve' then 'active' else 'rejected' end
  where id = target_profile_id
    and company_id = target_company_id
    and role = 'employee'
    and status = 'pending'
  returning * into reviewed_profile;

  if reviewed_profile.id is null then
    raise exception using errcode = '22023', message = 'The membership request is no longer pending or does not belong to this company.';
  end if;

  return to_jsonb(reviewed_profile);
end
$$;

create or replace function public.manage_employee_access(
  target_profile_id uuid,
  requested_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  managed_profile public.profiles%rowtype;
begin
  requested_status := lower(btrim(requested_status));

  if target_company_id is null
     or not app_private.is_company_admin(target_company_id) then
    raise exception using errcode = '42501', message = 'Only an active administrator can manage employee access.';
  end if;

  if requested_status not in ('active', 'suspended') then
    raise exception using errcode = '22023', message = 'Requested status must be active or suspended.';
  end if;

  update public.profiles
  set status = requested_status
  where id = target_profile_id
    and company_id = target_company_id
    and role = 'employee'
    and (
      (requested_status = 'suspended' and status = 'active')
      or (requested_status = 'active' and status in ('suspended', 'rejected'))
    )
  returning * into managed_profile;

  if managed_profile.id is null then
    raise exception using errcode = '22023', message = 'This employee access transition is not allowed.';
  end if;

  return to_jsonb(managed_profile);
end
$$;

create or replace function public.mark_notification_read(target_notification_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = target_notification_id
    and recipient_profile_id = (select auth.uid())
$$;

create or replace function public.mark_all_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set read_at = now()
  where recipient_profile_id = (select auth.uid())
    and read_at is null
$$;

revoke all on function public.review_membership_request(uuid, text) from public, anon, authenticated;
revoke all on function public.manage_employee_access(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_notification_read(uuid) from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read() from public, anon, authenticated;

grant execute on function public.review_membership_request(uuid, text) to authenticated;
grant execute on function public.manage_employee_access(uuid, text) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;

  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end
$$;

commit;

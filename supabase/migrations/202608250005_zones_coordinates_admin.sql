-- Persist map markers for logistics zones and restrict zone configuration to
-- active company admins. Active employees retain read access for shipments.

begin;

alter table public.zones
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists color varchar(20) not null default 'violet';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'zones_coordinates_logispro_check'
      and conrelid = 'public.zones'::regclass
  ) then
    alter table public.zones
      add constraint zones_coordinates_logispro_check
      check (
        (latitude is null and longitude is null)
        or
        (
          latitude between -90 and 90
          and longitude between -180 and 180
        )
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'zones_color_logispro_check'
      and conrelid = 'public.zones'::regclass
  ) then
    alter table public.zones
      add constraint zones_color_logispro_check
      check (color in ('violet', 'blue', 'emerald', 'amber', 'rose'));
  end if;
end
$$;

create unique index if not exists zones_company_name_key
  on public.zones (company_id, lower(btrim(name)));

drop policy if exists zones_insert_tenant on public.zones;
drop policy if exists zones_update_tenant on public.zones;
drop policy if exists zones_delete_tenant on public.zones;

create policy zones_insert_admin
on public.zones
for insert
to authenticated
with check (app_private.is_company_admin(company_id));

create policy zones_update_admin
on public.zones
for update
to authenticated
using (app_private.is_company_admin(company_id))
with check (app_private.is_company_admin(company_id));

create policy zones_delete_admin
on public.zones
for delete
to authenticated
using (app_private.is_company_admin(company_id));

commit;

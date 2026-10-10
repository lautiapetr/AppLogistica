-- Model individual cities and groups with child locations. Shipments retain the
-- selected Mapbox city, while a tenant-safe RPC resolves it to a group, an
-- existing individual city, or a newly created individual city (in that order).

begin;

alter table public.zones
  add column if not exists zone_type varchar(20) not null default 'city',
  add column if not exists mapbox_place_id text,
  add column if not exists place_label text;

alter table public.shipments
  add column if not exists destination_city text,
  add column if not exists destination_place_id text,
  add column if not exists destination_latitude double precision,
  add column if not exists destination_longitude double precision;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'zones_type_logispro_check'
      and conrelid = 'public.zones'::regclass
  ) then
    alter table public.zones
      add constraint zones_type_logispro_check
      check (zone_type in ('group', 'city'));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'shipments_destination_coordinates_logispro_check'
      and conrelid = 'public.shipments'::regclass
  ) then
    alter table public.shipments
      add constraint shipments_destination_coordinates_logispro_check
      check (
        (destination_latitude is null and destination_longitude is null)
        or (
          destination_latitude between -90 and 90
          and destination_longitude between -180 and 180
        )
      );
  end if;
end
$$;

drop index if exists public.zones_company_name_key;
create unique index if not exists zones_company_type_name_key
  on public.zones (company_id, zone_type, lower(btrim(name)));

create unique index if not exists zones_company_mapbox_city_key
  on public.zones (company_id, mapbox_place_id)
  where zone_type = 'city' and mapbox_place_id is not null;

create table if not exists public.zone_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app_private.current_company_id()
    references public.companies(id) on delete cascade,
  group_zone_id uuid not null references public.zones(id) on delete cascade,
  location_type varchar(20) not null,
  name varchar(120) not null,
  mapbox_place_id text,
  place_label text,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now(),
  constraint zone_locations_type_logispro_check
    check (location_type in ('city', 'custom')),
  constraint zone_locations_name_logispro_check
    check (char_length(btrim(name)) between 2 and 120),
  constraint zone_locations_coordinates_logispro_check
    check (latitude between -90 and 90 and longitude between -180 and 180)
);

create unique index if not exists zone_locations_group_type_name_key
  on public.zone_locations (group_zone_id, location_type, lower(btrim(name)));

create unique index if not exists zone_locations_company_mapbox_city_key
  on public.zone_locations (company_id, mapbox_place_id)
  where location_type = 'city' and mapbox_place_id is not null;

create or replace function app_private.validate_zone_location_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.zones as zone
    where zone.id = new.group_zone_id
      and zone.company_id = new.company_id
      and zone.zone_type = 'group'
  ) then
    raise exception using
      errcode = '23514',
      message = 'A zone location must belong to a group in the same company.';
  end if;

  new.name := btrim(new.name);
  new.mapbox_place_id := nullif(btrim(new.mapbox_place_id), '');
  new.place_label := nullif(btrim(new.place_label), '');
  return new;
end
$$;

drop trigger if exists validate_zone_location_group on public.zone_locations;
create trigger validate_zone_location_group
before insert or update on public.zone_locations
for each row execute function app_private.validate_zone_location_group();

revoke all on function app_private.validate_zone_location_group() from public, anon, authenticated;

alter table public.zone_locations enable row level security;
alter table public.zone_locations force row level security;

drop policy if exists zone_locations_select_tenant on public.zone_locations;
drop policy if exists zone_locations_insert_admin on public.zone_locations;
drop policy if exists zone_locations_update_admin on public.zone_locations;
drop policy if exists zone_locations_delete_admin on public.zone_locations;

create policy zone_locations_select_tenant
on public.zone_locations
for select
to authenticated
using (app_private.is_active_company_member(company_id));

create policy zone_locations_insert_admin
on public.zone_locations
for insert
to authenticated
with check (app_private.is_company_admin(company_id));

create policy zone_locations_update_admin
on public.zone_locations
for update
to authenticated
using (app_private.is_company_admin(company_id))
with check (app_private.is_company_admin(company_id));

create policy zone_locations_delete_admin
on public.zone_locations
for delete
to authenticated
using (app_private.is_company_admin(company_id));

revoke all on table public.zone_locations from anon, authenticated;
grant select, insert, update, delete on table public.zone_locations to authenticated;

create or replace function public.save_zone_configuration(
  target_zone_id uuid,
  zone_name text,
  requested_zone_type text,
  zone_color text,
  zone_latitude double precision,
  zone_longitude double precision,
  zone_mapbox_place_id text,
  zone_place_label text,
  zone_locations jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  saved_zone_id uuid;
  location_data jsonb;
  location_name text;
  location_type text;
  location_latitude double precision;
  location_longitude double precision;
begin
  if target_company_id is null
     or not app_private.is_company_admin(target_company_id) then
    raise exception using errcode = '42501', message = 'Only an active company admin can configure zones.';
  end if;

  zone_name := btrim(zone_name);
  zone_mapbox_place_id := nullif(btrim(zone_mapbox_place_id), '');
  zone_place_label := nullif(btrim(zone_place_label), '');

  if zone_name is null or char_length(zone_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Zone name must contain between 2 and 120 characters.';
  end if;

  if requested_zone_type not in ('group', 'city') then
    raise exception using errcode = '22023', message = 'Zone type must be group or city.';
  end if;

  if zone_color not in ('violet', 'blue', 'emerald', 'amber', 'rose') then
    raise exception using errcode = '22023', message = 'Invalid zone color.';
  end if;

  if jsonb_typeof(coalesce(zone_locations, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Zone locations must be an array.';
  end if;

  if requested_zone_type = 'city' and (
    zone_latitude is null or zone_longitude is null
    or zone_latitude not between -90 and 90
    or zone_longitude not between -180 and 180
  ) then
    raise exception using errcode = '22023', message = 'An individual city requires valid coordinates.';
  end if;

  if requested_zone_type = 'group' then
    zone_latitude := null;
    zone_longitude := null;
    zone_mapbox_place_id := null;
    zone_place_label := null;
  end if;

  if target_zone_id is null then
    insert into public.zones (
      company_id, name, zone_type, color, latitude, longitude,
      mapbox_place_id, place_label
    ) values (
      target_company_id, zone_name, requested_zone_type, zone_color,
      zone_latitude, zone_longitude, zone_mapbox_place_id, zone_place_label
    ) returning id into saved_zone_id;
  else
    if not exists (
      select 1 from public.zones
      where id = target_zone_id and company_id = target_company_id
    ) then
      raise exception using errcode = '42501', message = 'The selected zone does not belong to this company.';
    end if;

    update public.zones
    set name = zone_name,
        zone_type = requested_zone_type,
        color = zone_color,
        latitude = zone_latitude,
        longitude = zone_longitude,
        mapbox_place_id = zone_mapbox_place_id,
        place_label = zone_place_label
    where id = target_zone_id;

    saved_zone_id := target_zone_id;
  end if;

  delete from public.zone_locations where group_zone_id = saved_zone_id;

  if requested_zone_type = 'group' then
    for location_data in
      select value from jsonb_array_elements(coalesce(zone_locations, '[]'::jsonb))
    loop
      location_name := btrim(location_data ->> 'name');
      location_type := location_data ->> 'location_type';
      location_latitude := (location_data ->> 'latitude')::double precision;
      location_longitude := (location_data ->> 'longitude')::double precision;

      if location_name is null or char_length(location_name) not between 2 and 120
         or location_type not in ('city', 'custom')
         or location_latitude not between -90 and 90
         or location_longitude not between -180 and 180 then
        raise exception using errcode = '22023', message = 'A group contains an invalid location.';
      end if;

      insert into public.zone_locations (
        company_id, group_zone_id, location_type, name, mapbox_place_id,
        place_label, latitude, longitude
      ) values (
        target_company_id,
        saved_zone_id,
        location_type,
        location_name,
        nullif(btrim(location_data ->> 'mapbox_place_id'), ''),
        nullif(btrim(location_data ->> 'place_label'), ''),
        location_latitude,
        location_longitude
      );
    end loop;
  end if;

  return saved_zone_id;
end
$$;

create or replace function public.resolve_destination_zone(
  city_name text,
  city_mapbox_place_id text,
  city_place_label text,
  city_latitude double precision,
  city_longitude double precision
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  resolved_zone_id uuid;
begin
  city_name := btrim(city_name);
  city_mapbox_place_id := nullif(btrim(city_mapbox_place_id), '');
  city_place_label := nullif(btrim(city_place_label), '');

  if target_company_id is null then
    raise exception using errcode = '42501', message = 'An active company profile is required.';
  end if;

  if city_name is null or char_length(city_name) not between 2 and 120
     or city_mapbox_place_id is null
     or city_latitude not between -90 and 90
     or city_longitude not between -180 and 180 then
    raise exception using errcode = '22023', message = 'A valid Mapbox city is required.';
  end if;

  -- Explicit group membership has priority over an individual city record.
  select location.group_zone_id
  into resolved_zone_id
  from public.zone_locations as location
  where location.company_id = target_company_id
    and location.location_type = 'city'
    and (
      location.mapbox_place_id = city_mapbox_place_id
      or (
        location.mapbox_place_id is null
        and lower(btrim(location.name)) = lower(city_name)
      )
    )
  limit 1;

  if resolved_zone_id is not null then
    return resolved_zone_id;
  end if;

  select zone.id
  into resolved_zone_id
  from public.zones as zone
  where zone.company_id = target_company_id
    and zone.zone_type = 'city'
    and (
      zone.mapbox_place_id = city_mapbox_place_id
      or (
        zone.mapbox_place_id is null
        and lower(btrim(zone.name)) = lower(city_name)
      )
    )
  limit 1;

  if resolved_zone_id is not null then
    return resolved_zone_id;
  end if;

  begin
    insert into public.zones (
      company_id, name, zone_type, color, latitude, longitude,
      mapbox_place_id, place_label
    ) values (
      target_company_id, city_name, 'city', 'violet', city_latitude,
      city_longitude, city_mapbox_place_id, city_place_label
    ) returning id into resolved_zone_id;
  exception
    when unique_violation then
      select zone.id
      into resolved_zone_id
      from public.zones as zone
      where zone.company_id = target_company_id
        and zone.zone_type = 'city'
        and (
          zone.mapbox_place_id = city_mapbox_place_id
          or lower(btrim(zone.name)) = lower(city_name)
        )
      limit 1;
  end;

  if resolved_zone_id is null then
    raise exception using errcode = '23505', message = 'The destination city could not be resolved.';
  end if;

  return resolved_zone_id;
end
$$;

create or replace function public.save_shipment_with_destination(
  target_shipment_id uuid,
  shipment_tracking_number text,
  shipment_client_id uuid,
  shipment_delivery_address text,
  shipment_status text,
  city_name text,
  city_mapbox_place_id text,
  city_place_label text,
  city_latitude double precision,
  city_longitude double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  resolved_zone_id uuid;
  saved_shipment public.shipments%rowtype;
begin
  if target_company_id is null then
    raise exception using errcode = '42501', message = 'An active company profile is required.';
  end if;

  select public.resolve_destination_zone(
    city_name,
    city_mapbox_place_id,
    city_place_label,
    city_latitude,
    city_longitude
  ) into resolved_zone_id;

  if target_shipment_id is null then
    insert into public.shipments (
      company_id, client_id, zone_id, tracking_number, delivery_address, status,
      destination_city, destination_place_id, destination_latitude,
      destination_longitude
    ) values (
      target_company_id,
      shipment_client_id,
      resolved_zone_id,
      upper(btrim(shipment_tracking_number)),
      btrim(shipment_delivery_address),
      shipment_status,
      btrim(city_name),
      btrim(city_mapbox_place_id),
      city_latitude,
      city_longitude
    ) returning * into saved_shipment;
  else
    update public.shipments
    set client_id = shipment_client_id,
        zone_id = resolved_zone_id,
        tracking_number = upper(btrim(shipment_tracking_number)),
        delivery_address = btrim(shipment_delivery_address),
        status = shipment_status,
        destination_city = btrim(city_name),
        destination_place_id = btrim(city_mapbox_place_id),
        destination_latitude = city_latitude,
        destination_longitude = city_longitude
    where id = target_shipment_id
      and company_id = target_company_id
    returning * into saved_shipment;

    if saved_shipment.id is null then
      raise exception using errcode = '42501', message = 'The selected shipment does not belong to this company.';
    end if;
  end if;

  return to_jsonb(saved_shipment);
end
$$;

revoke all on function public.save_zone_configuration(
  uuid, text, text, text, double precision, double precision, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.resolve_destination_zone(
  text, text, text, double precision, double precision
) from public, anon, authenticated;
revoke all on function public.save_shipment_with_destination(
  uuid, text, uuid, text, text, text, text, text, double precision, double precision
) from public, anon, authenticated;

-- Browser writes must use the transactional RPC so zone resolution cannot be
-- bypassed and an automatically created city cannot outlive a failed shipment.
revoke insert, update on table public.shipments from authenticated;

grant execute on function public.save_zone_configuration(
  uuid, text, text, text, double precision, double precision, text, text, jsonb
) to authenticated;
grant execute on function public.save_shipment_with_destination(
  uuid, text, uuid, text, text, text, text, text, double precision, double precision
) to authenticated;

commit;

-- Replace provider-specific runtime assumptions with provider-neutral place
-- identifiers. Legacy column and RPC argument names are intentionally retained
-- so already-deployed clients and migrations keep working.

begin;

comment on column public.zones.mapbox_place_id is
  'Legacy column name. Stores a provider-neutral external place identifier (currently OpenStreetMap).';
comment on column public.zone_locations.mapbox_place_id is
  'Legacy column name. Stores a provider-neutral external place identifier (currently OpenStreetMap).';

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
    raise exception using errcode = '42501', message = 'Se requiere una empresa activa.';
  end if;

  if city_name is null or char_length(city_name) not between 2 and 120
     or city_mapbox_place_id is null
     or city_latitude not between -90 and 90
     or city_longitude not between -180 and 180 then
    raise exception using errcode = '22023', message = 'Selecciona una ciudad válida.';
  end if;

  -- Exact external identity wins. During the Mapbox -> OpenStreetMap transition,
  -- the same city may have a different provider ID, so a nearby same-name point
  -- is accepted without rewriting the existing zone configuration.
  select location.group_zone_id
  into resolved_zone_id
  from public.zone_locations as location
  where location.company_id = target_company_id
    and location.location_type = 'city'
    and (
      location.mapbox_place_id = city_mapbox_place_id
      or (
        lower(btrim(location.name)) = lower(city_name)
        and abs(location.latitude - city_latitude) <= 0.05
        and abs(location.longitude - city_longitude) <= 0.05
      )
    )
  order by (location.mapbox_place_id = city_mapbox_place_id) desc
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
        lower(btrim(zone.name)) = lower(city_name)
        and abs(zone.latitude - city_latitude) <= 0.05
        and abs(zone.longitude - city_longitude) <= 0.05
      )
    )
  order by (zone.mapbox_place_id = city_mapbox_place_id) desc
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
      order by (zone.mapbox_place_id = city_mapbox_place_id) desc
      limit 1;
  end;

  if resolved_zone_id is null then
    raise exception using errcode = '23505', message = 'No pudimos resolver la zona del destino.';
  end if;

  return resolved_zone_id;
end
$$;

revoke all on function public.resolve_destination_zone(
  text, text, text, double precision, double precision
) from public, anon, authenticated;

commit;

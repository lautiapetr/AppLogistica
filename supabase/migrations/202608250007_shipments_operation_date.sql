-- Add an explicit operational date to each shipment. The browser sends the
-- user's selected calendar date; current_date remains a database fallback.

begin;

alter table public.shipments
  add column if not exists shipment_date date not null default current_date;

revoke all on function public.save_shipment_with_destination(
  uuid, text, uuid, text, text, text, text, text, double precision, double precision
) from public, anon, authenticated;

drop function public.save_shipment_with_destination(
  uuid, text, uuid, text, text, text, text, text, double precision, double precision
);

create function public.save_shipment_with_destination(
  target_shipment_id uuid,
  shipment_tracking_number text,
  shipment_client_id uuid,
  shipment_delivery_address text,
  shipment_status text,
  requested_shipment_date date,
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

  if requested_shipment_date is null then
    raise exception using errcode = '22023', message = 'A shipment date is required.';
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
      shipment_date, destination_city, destination_place_id,
      destination_latitude, destination_longitude
    ) values (
      target_company_id,
      shipment_client_id,
      resolved_zone_id,
      upper(btrim(shipment_tracking_number)),
      btrim(shipment_delivery_address),
      shipment_status,
      requested_shipment_date,
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
        shipment_date = requested_shipment_date,
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

revoke all on function public.save_shipment_with_destination(
  uuid, text, uuid, text, text, date, text, text, text, double precision, double precision
) from public, anon, authenticated;

grant execute on function public.save_shipment_with_destination(
  uuid, text, uuid, text, text, date, text, text, text, double precision, double precision
) to authenticated;

commit;

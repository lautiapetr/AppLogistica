-- Phase 5 Statistics V1: tenant-safe operational aggregates and filter
-- options. Dashboard calculations stay in PostgreSQL and use shipment_date.

begin;

create index if not exists shipments_company_date_idx
  on public.shipments (company_id, shipment_date);

create index if not exists shipments_company_date_status_idx
  on public.shipments (company_id, shipment_date, status);

create index if not exists shipments_company_zone_date_idx
  on public.shipments (company_id, zone_id, shipment_date);

create index if not exists shipments_company_client_date_idx
  on public.shipments (company_id, client_id, shipment_date);

create index if not exists shipments_company_destination_date_idx
  on public.shipments (company_id, destination_place_id, shipment_date)
  where destination_place_id is not null;

create or replace function public.get_operational_statistics(
  requested_date_from date,
  requested_date_to date,
  requested_status text,
  requested_zone_id uuid,
  requested_client_id uuid,
  requested_destination_place_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  previous_date_to date;
  previous_date_from date;
  period_days integer;
  statistics jsonb;
begin
  requested_status := nullif(btrim(requested_status), '');
  requested_destination_place_id := nullif(btrim(requested_destination_place_id), '');

  if target_company_id is null then
    raise exception using errcode = '42501', message = 'An active company profile is required.';
  end if;

  if requested_date_from is null or requested_date_to is null
     or requested_date_from > requested_date_to then
    raise exception using errcode = '22023', message = 'A valid statistics date range is required.';
  end if;

  period_days := (requested_date_to - requested_date_from) + 1;
  if period_days > 366 then
    raise exception using errcode = '22023', message = 'Statistics ranges cannot exceed 366 days.';
  end if;

  if requested_status is not null
     and requested_status not in ('pending', 'in_transit', 'delivered', 'incident') then
    raise exception using errcode = '22023', message = 'Invalid shipment status filter.';
  end if;

  if requested_zone_id is not null and not exists (
    select 1 from public.zones
    where id = requested_zone_id and company_id = target_company_id
  ) then
    raise exception using errcode = '22023', message = 'The selected zone does not belong to this company.';
  end if;

  if requested_client_id is not null and not exists (
    select 1 from public.clients
    where id = requested_client_id and company_id = target_company_id
  ) then
    raise exception using errcode = '22023', message = 'The selected client does not belong to this company.';
  end if;

  previous_date_to := requested_date_from - 1;
  previous_date_from := previous_date_to - (period_days - 1);

  with current_shipments as materialized (
    select shipment.*
    from public.shipments as shipment
    where shipment.company_id = target_company_id
      and shipment.shipment_date between requested_date_from and requested_date_to
      and (requested_status is null or shipment.status = requested_status)
      and (requested_zone_id is null or shipment.zone_id = requested_zone_id)
      and (requested_client_id is null or shipment.client_id = requested_client_id)
      and (
        requested_destination_place_id is null
        or shipment.destination_place_id = requested_destination_place_id
      )
  ),
  previous_shipments as materialized (
    select shipment.*
    from public.shipments as shipment
    where shipment.company_id = target_company_id
      and shipment.shipment_date between previous_date_from and previous_date_to
      and (requested_status is null or shipment.status = requested_status)
      and (requested_zone_id is null or shipment.zone_id = requested_zone_id)
      and (requested_client_id is null or shipment.client_id = requested_client_id)
      and (
        requested_destination_place_id is null
        or shipment.destination_place_id = requested_destination_place_id
      )
  )
  select jsonb_build_object(
    'dateFrom', requested_date_from,
    'dateTo', requested_date_to,
    'previousDateFrom', previous_date_from,
    'previousDateTo', previous_date_to,
    'summary', (
      select jsonb_build_object(
        'total', count(*),
        'pending', count(*) filter (where status = 'pending'),
        'inTransit', count(*) filter (where status = 'in_transit'),
        'delivered', count(*) filter (where status = 'delivered'),
        'incidents', count(*) filter (where status = 'incident'),
        'deliveryRate', coalesce(
          round(100.0 * count(*) filter (where status = 'delivered') / nullif(count(*), 0), 1),
          0
        ),
        'averageDailyVolume', round(count(*)::numeric / period_days, 1),
        'previousTotal', (select count(*) from previous_shipments),
        'previousDelivered', (
          select count(*) from previous_shipments where status = 'delivered'
        ),
        'previousIncidents', (
          select count(*) from previous_shipments where status = 'incident'
        ),
        'previousDeliveryRate', coalesce((
          select round(
            100.0 * count(*) filter (where status = 'delivered') / nullif(count(*), 0),
            1
          )
          from previous_shipments
        ), 0)
      )
      from current_shipments
    ),
    'trend', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', trend_day,
          'total', total,
          'delivered', delivered,
          'incidents', incidents
        ) order by trend_day
      )
      from (
        select
          generated_day::date as trend_day,
          count(shipment.id) as total,
          count(shipment.id) filter (where shipment.status = 'delivered') as delivered,
          count(shipment.id) filter (where shipment.status = 'incident') as incidents
        from generate_series(
          requested_date_from::timestamp,
          requested_date_to::timestamp,
          interval '1 day'
        ) as generated_day
        left join current_shipments as shipment
          on shipment.shipment_date = generated_day::date
        group by generated_day
      ) as trend_rows
    ), '[]'::jsonb),
    'statusDistribution', coalesce((
      select jsonb_agg(
        jsonb_build_object('status', status, 'count', shipment_count)
        order by sort_order
      )
      from (
        select
          status_option.status,
          status_option.sort_order,
          count(shipment.id) as shipment_count
        from (
          values
            ('pending', 1),
            ('in_transit', 2),
            ('delivered', 3),
            ('incident', 4)
        ) as status_option(status, sort_order)
        left join current_shipments as shipment on shipment.status = status_option.status
        group by status_option.status, status_option.sort_order
      ) as status_rows
    ), '[]'::jsonb),
    'topZones', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', zone_id, 'label', zone_name, 'count', shipment_count)
        order by shipment_count desc, zone_name
      )
      from (
        select
          zone.id as zone_id,
          zone.name as zone_name,
          count(*) as shipment_count
        from current_shipments as shipment
        join public.zones as zone on zone.id = shipment.zone_id
        group by zone.id, zone.name
        order by shipment_count desc, zone.name
        limit 5
      ) as zone_ranking
    ), '[]'::jsonb),
    'topCities', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', destination_place_id,
          'label', destination_city,
          'count', shipment_count
        ) order by shipment_count desc, destination_city
      )
      from (
        select
          shipment.destination_place_id,
          coalesce(shipment.destination_city, 'Ciudad sin nombre') as destination_city,
          count(*) as shipment_count
        from current_shipments as shipment
        where shipment.destination_place_id is not null
        group by shipment.destination_place_id, shipment.destination_city
        order by shipment_count desc, destination_city
        limit 5
      ) as city_ranking
    ), '[]'::jsonb),
    'topClients', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', client_id, 'label', client_name, 'count', shipment_count)
        order by shipment_count desc, client_name
      )
      from (
        select
          client.id as client_id,
          case
            when client.client_type = 'company' then coalesce(client.business_name, 'Empresa sin nombre')
            else coalesce(
              nullif(btrim(concat_ws(' ', client.first_name, client.last_name)), ''),
              'Individuo sin nombre'
            )
          end as client_name,
          count(*) as shipment_count
        from current_shipments as shipment
        join public.clients as client on client.id = shipment.client_id
        group by client.id, client.client_type, client.business_name, client.first_name, client.last_name
        order by shipment_count desc, client_name
        limit 5
      ) as client_ranking
    ), '[]'::jsonb)
  )
  into statistics;

  return statistics;
end
$$;

create or replace function public.get_statistics_filter_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  options jsonb;
begin
  if target_company_id is null then
    raise exception using errcode = '42501', message = 'An active company profile is required.';
  end if;

  select jsonb_build_object(
    'clients', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', client_id, 'label', client_name)
        order by client_name
      )
      from (
        select
          client.id as client_id,
          case
            when client.client_type = 'company' then coalesce(client.business_name, 'Empresa sin nombre')
            else coalesce(
              nullif(btrim(concat_ws(' ', client.first_name, client.last_name)), ''),
              'Individuo sin nombre'
            )
          end as client_name
        from public.clients as client
        where client.company_id = target_company_id
      ) as client_options
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', id, 'label', name, 'type', zone_type)
        order by name
      )
      from public.zones
      where company_id = target_company_id
    ), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', destination_place_id, 'label', destination_city)
        order by destination_city
      )
      from (
        select destination_place_id, min(destination_city) as destination_city
        from public.shipments
        where company_id = target_company_id
          and destination_place_id is not null
          and destination_city is not null
        group by destination_place_id
      ) as city_options
    ), '[]'::jsonb)
  ) into options;

  return options;
end
$$;

revoke all on function public.get_operational_statistics(
  date, date, text, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.get_statistics_filter_options()
  from public, anon, authenticated;

grant execute on function public.get_operational_statistics(
  date, date, text, uuid, uuid, text
) to authenticated;
grant execute on function public.get_statistics_filter_options()
  to authenticated;

commit;

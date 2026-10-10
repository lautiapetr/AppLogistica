-- Phase 9.3: paginated financial-statistics export over immutable current
-- pricing snapshots. Each row retains its own ISO currency and accounting
-- estimates are never represented as invoices, receivables, or collections.

begin;

create or replace function public.get_financial_statistics_export(
  requested_date_from date,
  requested_date_to date,
  requested_status text,
  requested_zone_id uuid,
  requested_client_id uuid,
  requested_destination_place_id text,
  requested_offset integer,
  requested_limit integer
)
returns table (
  shipment_id uuid,
  tracking_number text,
  shipment_date date,
  status text,
  client_name text,
  zone_name text,
  destination_city text,
  rate_card_name text,
  version_number integer,
  currency text,
  charge_total numeric,
  discount_total numeric,
  estimated_revenue numeric,
  internal_cost_total numeric,
  commission_total numeric,
  estimated_cost_total numeric,
  estimated_margin numeric,
  margin_rate numeric,
  tax_total numeric,
  included_tax_total numeric,
  added_tax_total numeric,
  calculated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
begin
  requested_status := nullif(btrim(requested_status), '');
  requested_destination_place_id := nullif(btrim(requested_destination_place_id), '');
  requested_offset := coalesce(requested_offset, 0);
  requested_limit := coalesce(requested_limit, 1000);

  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'statistics.export')
     or not app_private.has_permission(target_company_id, 'pricing.view') then
    raise exception using errcode = '42501', message = 'No tienes permiso para exportar estadísticas económicas.';
  end if;

  if requested_date_from is null or requested_date_to is null
     or requested_date_from > requested_date_to
     or requested_date_to - requested_date_from > 365 then
    raise exception using errcode = '22023', message = 'Selecciona un rango de exportación válido de hasta 366 días.';
  end if;

  if requested_status is not null
     and requested_status not in ('pending', 'in_transit', 'delivered', 'incident') then
    raise exception using errcode = '22023', message = 'El estado seleccionado es inválido.';
  end if;

  if requested_offset < 0 or requested_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'La paginación de exportación es inválida.';
  end if;

  if requested_zone_id is not null and not exists (
    select 1 from public.zones
    where id = requested_zone_id and company_id = target_company_id
  ) then
    raise exception using errcode = '22023', message = 'La zona seleccionada no pertenece a esta empresa.';
  end if;

  if requested_client_id is not null and not exists (
    select 1 from public.clients
    where id = requested_client_id and company_id = target_company_id
  ) then
    raise exception using errcode = '22023', message = 'El cliente seleccionado no pertenece a esta empresa.';
  end if;

  return query
  select
    shipment.id,
    shipment.tracking_number::text,
    shipment.shipment_date,
    shipment.status::text,
    case
      when client.client_type = 'company' then coalesce(client.business_name, 'Empresa sin nombre')
      else coalesce(
        nullif(btrim(concat_ws(' ', client.first_name, client.last_name)), ''),
        'Cliente sin nombre'
      )
    end::text,
    zone.name::text,
    shipment.destination_city::text,
    calculation.rate_card_name_snapshot::text,
    calculation.version_number_snapshot,
    btrim(calculation.currency)::text,
    round(calculation.charge_total, 2),
    round(calculation.discount_total, 2),
    round(calculation.customer_total, 2),
    round(calculation.internal_cost_total, 2),
    round(calculation.commission_total, 2),
    round(calculation.internal_cost_total + calculation.commission_total, 2),
    round(
      calculation.customer_total
        - calculation.internal_cost_total
        - calculation.commission_total,
      2
    ),
    coalesce(round(
      100.0 * (
        calculation.customer_total
          - calculation.internal_cost_total
          - calculation.commission_total
      ) / nullif(calculation.customer_total, 0),
      1
    ), 0),
    round(calculation.tax_total, 2),
    round(calculation.included_tax_total, 2),
    round(calculation.added_tax_total, 2),
    calculation.created_at
  from public.shipments as shipment
  join public.shipment_pricing_calculations as calculation
    on calculation.id = shipment.current_pricing_calculation_id
   and calculation.shipment_id = shipment.id
   and calculation.company_id = shipment.company_id
  left join public.clients as client
    on client.id = shipment.client_id and client.company_id = shipment.company_id
  left join public.zones as zone
    on zone.id = shipment.zone_id and zone.company_id = shipment.company_id
  where shipment.company_id = target_company_id
    and shipment.shipment_date between requested_date_from and requested_date_to
    and (requested_status is null or shipment.status = requested_status)
    and (requested_zone_id is null or shipment.zone_id = requested_zone_id)
    and (requested_client_id is null or shipment.client_id = requested_client_id)
    and (
      requested_destination_place_id is null
      or shipment.destination_place_id = requested_destination_place_id
    )
  order by shipment.shipment_date, shipment.id
  offset requested_offset
  limit requested_limit;
end
$$;

revoke all on function public.get_financial_statistics_export(
  date, date, text, uuid, uuid, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.get_financial_statistics_export(
  date, date, text, uuid, uuid, text, integer, integer
) to authenticated;

commit;

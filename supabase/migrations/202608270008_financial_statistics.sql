-- Phase 9.1: tenant-safe financial analytics over the immutable current
-- shipment pricing snapshot. Amounts are estimates, never billing or payment
-- state, and currencies are always aggregated independently.

begin;

create index if not exists shipments_company_date_current_pricing_idx
  on public.shipments (company_id, shipment_date, current_pricing_calculation_id)
  where current_pricing_calculation_id is not null;

create or replace function public.get_authorized_financial_statistics(
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
  result jsonb;
begin
  requested_status := nullif(btrim(requested_status), '');
  requested_destination_place_id := nullif(btrim(requested_destination_place_id), '');

  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'statistics.view')
     or not app_private.has_permission(target_company_id, 'pricing.view') then
    raise exception using errcode = '42501', message = 'No tienes permiso para consultar estadísticas económicas.';
  end if;

  if requested_date_from is null or requested_date_to is null
     or requested_date_from > requested_date_to then
    raise exception using errcode = '22023', message = 'Selecciona un rango de fechas válido.';
  end if;

  period_days := (requested_date_to - requested_date_from) + 1;
  if period_days > 366 then
    raise exception using errcode = '22023', message = 'El rango estadístico no puede superar 366 días.';
  end if;

  if requested_status is not null
     and requested_status not in ('pending', 'in_transit', 'delivered', 'incident') then
    raise exception using errcode = '22023', message = 'El estado seleccionado es inválido.';
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
  ),
  current_priced as materialized (
    select
      shipment.id as shipment_id,
      shipment.company_id,
      shipment.client_id,
      shipment.zone_id,
      shipment.destination_place_id,
      shipment.destination_city,
      calculation.currency,
      calculation.charge_total,
      calculation.discount_total,
      calculation.customer_total,
      calculation.internal_cost_total,
      calculation.commission_total,
      calculation.tax_total,
      calculation.included_tax_total,
      calculation.added_tax_total
    from current_shipments as shipment
    join public.shipment_pricing_calculations as calculation
      on calculation.id = shipment.current_pricing_calculation_id
     and calculation.shipment_id = shipment.id
     and calculation.company_id = shipment.company_id
  ),
  previous_priced as materialized (
    select
      shipment.id as shipment_id,
      calculation.currency,
      calculation.customer_total,
      calculation.internal_cost_total,
      calculation.commission_total
    from previous_shipments as shipment
    join public.shipment_pricing_calculations as calculation
      on calculation.id = shipment.current_pricing_calculation_id
     and calculation.shipment_id = shipment.id
     and calculation.company_id = shipment.company_id
  ),
  current_currency as (
    select
      btrim(currency) as currency,
      count(*) as priced_shipments,
      sum(charge_total) as charge_total,
      sum(discount_total) as discount_total,
      sum(customer_total) as estimated_revenue,
      sum(internal_cost_total) as internal_cost_total,
      sum(commission_total) as commission_total,
      sum(tax_total) as tax_total,
      sum(included_tax_total) as included_tax_total,
      sum(added_tax_total) as added_tax_total
    from current_priced
    group by btrim(currency)
  ),
  previous_currency as (
    select
      btrim(currency) as currency,
      count(*) as priced_shipments,
      sum(customer_total) as estimated_revenue,
      sum(internal_cost_total + commission_total) as estimated_cost_total
    from previous_priced
    group by btrim(currency)
  ),
  currency_summary as (
    select
      current_data.currency,
      coalesce(current_data.priced_shipments, 0) as priced_shipments,
      coalesce(current_data.charge_total, 0) as charge_total,
      coalesce(current_data.discount_total, 0) as discount_total,
      coalesce(current_data.estimated_revenue, 0) as estimated_revenue,
      coalesce(current_data.internal_cost_total, 0) as internal_cost_total,
      coalesce(current_data.commission_total, 0) as commission_total,
      coalesce(current_data.internal_cost_total, 0)
        + coalesce(current_data.commission_total, 0) as estimated_cost_total,
      coalesce(current_data.estimated_revenue, 0)
        - coalesce(current_data.internal_cost_total, 0)
        - coalesce(current_data.commission_total, 0) as estimated_margin,
      coalesce(current_data.tax_total, 0) as tax_total,
      coalesce(current_data.included_tax_total, 0) as included_tax_total,
      coalesce(current_data.added_tax_total, 0) as added_tax_total,
      coalesce(previous_data.priced_shipments, 0) as previous_priced_shipments,
      coalesce(previous_data.estimated_revenue, 0) as previous_estimated_revenue,
      coalesce(previous_data.estimated_revenue, 0)
        - coalesce(previous_data.estimated_cost_total, 0) as previous_estimated_margin
    from current_currency as current_data
    left join previous_currency as previous_data using (currency)
  ),
  profitability_by_client as (
    select
      priced.currency,
      client.id,
      case
        when client.client_type = 'company' then coalesce(client.business_name, 'Empresa sin nombre')
        else coalesce(
          nullif(btrim(concat_ws(' ', client.first_name, client.last_name)), ''),
          'Individuo sin nombre'
        )
      end as label,
      count(*) as shipment_count,
      sum(priced.customer_total) as revenue,
      sum(priced.internal_cost_total + priced.commission_total) as cost,
      sum(priced.customer_total - priced.internal_cost_total - priced.commission_total) as margin
    from current_priced as priced
    join public.clients as client
      on client.id = priced.client_id and client.company_id = priced.company_id
    group by priced.currency, client.id, client.client_type, client.business_name,
      client.first_name, client.last_name
  ),
  profitability_by_zone as (
    select
      priced.currency,
      zone.id,
      zone.name as label,
      count(*) as shipment_count,
      sum(priced.customer_total) as revenue,
      sum(priced.internal_cost_total + priced.commission_total) as cost,
      sum(priced.customer_total - priced.internal_cost_total - priced.commission_total) as margin
    from current_priced as priced
    join public.zones as zone
      on zone.id = priced.zone_id and zone.company_id = priced.company_id
    group by priced.currency, zone.id, zone.name
  ),
  profitability_by_city as (
    select
      priced.currency,
      priced.destination_place_id as id,
      coalesce(min(priced.destination_city), 'Ciudad sin nombre') as label,
      count(*) as shipment_count,
      sum(priced.customer_total) as revenue,
      sum(priced.internal_cost_total + priced.commission_total) as cost,
      sum(priced.customer_total - priced.internal_cost_total - priced.commission_total) as margin
    from current_priced as priced
    where priced.destination_place_id is not null
    group by priced.currency, priced.destination_place_id
  )
  select jsonb_build_object(
    'dateFrom', requested_date_from,
    'dateTo', requested_date_to,
    'previousDateFrom', previous_date_from,
    'previousDateTo', previous_date_to,
    'coverage', jsonb_build_object(
      'totalShipments', (select count(*) from current_shipments),
      'pricedShipments', (select count(*) from current_priced),
      'unpricedShipments',
        (select count(*) from current_shipments) - (select count(*) from current_priced),
      'coverageRate', coalesce(round(
        100.0 * (select count(*) from current_priced)
        / nullif((select count(*) from current_shipments), 0), 1
      ), 0)
    ),
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', currency,
        'pricedShipments', priced_shipments,
        'chargeTotal', round(charge_total, 2),
        'discountTotal', round(discount_total, 2),
        'estimatedRevenue', round(estimated_revenue, 2),
        'internalCostTotal', round(internal_cost_total, 2),
        'commissionTotal', round(commission_total, 2),
        'estimatedCostTotal', round(estimated_cost_total, 2),
        'estimatedMargin', round(estimated_margin, 2),
        'marginRate', coalesce(round(100.0 * estimated_margin / nullif(estimated_revenue, 0), 1), 0),
        'averageTicket', coalesce(round(estimated_revenue / nullif(priced_shipments, 0), 2), 0),
        'taxTotal', round(tax_total, 2),
        'includedTaxTotal', round(included_tax_total, 2),
        'addedTaxTotal', round(added_tax_total, 2),
        'previousPricedShipments', previous_priced_shipments,
        'previousEstimatedRevenue', round(previous_estimated_revenue, 2),
        'previousEstimatedMargin', round(previous_estimated_margin, 2)
      ) order by currency)
      from currency_summary
    ), '[]'::jsonb),
    'topClients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'label', label, 'currency', btrim(currency),
        'shipmentCount', shipment_count, 'revenue', round(revenue, 2),
        'cost', round(cost, 2), 'margin', round(margin, 2),
        'marginRate', coalesce(round(100.0 * margin / nullif(revenue, 0), 1), 0)
      ) order by currency, ranking_position)
      from (
        select ranking.*, row_number() over (
          partition by currency order by margin desc, label
        ) as ranking_position
        from profitability_by_client as ranking
      ) as ranked
      where ranking_position <= 5
    ), '[]'::jsonb),
    'topZones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'label', label, 'currency', btrim(currency),
        'shipmentCount', shipment_count, 'revenue', round(revenue, 2),
        'cost', round(cost, 2), 'margin', round(margin, 2),
        'marginRate', coalesce(round(100.0 * margin / nullif(revenue, 0), 1), 0)
      ) order by currency, ranking_position)
      from (
        select ranking.*, row_number() over (
          partition by currency order by margin desc, label
        ) as ranking_position
        from profitability_by_zone as ranking
      ) as ranked
      where ranking_position <= 5
    ), '[]'::jsonb),
    'topCities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'label', label, 'currency', btrim(currency),
        'shipmentCount', shipment_count, 'revenue', round(revenue, 2),
        'cost', round(cost, 2), 'margin', round(margin, 2),
        'marginRate', coalesce(round(100.0 * margin / nullif(revenue, 0), 1), 0)
      ) order by currency, ranking_position)
      from (
        select ranking.*, row_number() over (
          partition by currency order by margin desc, label
        ) as ranking_position
        from profitability_by_city as ranking
      ) as ranked
      where ranking_position <= 5
    ), '[]'::jsonb)
  ) into result;

  return result;
end
$$;

revoke all on function public.get_authorized_financial_statistics(
  date, date, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.get_authorized_financial_statistics(
  date, date, text, uuid, uuid, text
) to authenticated;

commit;

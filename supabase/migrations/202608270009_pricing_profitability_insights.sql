-- Phase 9.2: rate-card version profitability comparisons and low-margin
-- shipment alerts over immutable current pricing snapshots.

begin;

create or replace function public.get_authorized_pricing_profitability_insights(
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
  period_days integer;
  low_margin_threshold numeric := 10;
  result jsonb;
begin
  requested_status := nullif(btrim(requested_status), '');
  requested_destination_place_id := nullif(btrim(requested_destination_place_id), '');

  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'statistics.view')
     or not app_private.has_permission(target_company_id, 'pricing.view') then
    raise exception using errcode = '42501', message = 'No tienes permiso para consultar análisis de rentabilidad.';
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

  with priced_shipments as materialized (
    select
      shipment.id as shipment_id,
      shipment.tracking_number,
      shipment.shipment_date,
      shipment.client_id,
      calculation.rate_card_id,
      calculation.rate_card_version_id,
      calculation.rate_card_name_snapshot,
      calculation.version_number_snapshot,
      btrim(calculation.currency) as currency,
      calculation.customer_total as revenue,
      calculation.internal_cost_total + calculation.commission_total as cost,
      calculation.customer_total
        - calculation.internal_cost_total
        - calculation.commission_total as margin
    from public.shipments as shipment
    join public.shipment_pricing_calculations as calculation
      on calculation.id = shipment.current_pricing_calculation_id
     and calculation.shipment_id = shipment.id
     and calculation.company_id = shipment.company_id
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
  version_profitability as (
    select
      rate_card_id,
      rate_card_version_id,
      rate_card_name_snapshot,
      version_number_snapshot,
      currency,
      count(*) as shipment_count,
      sum(revenue) as revenue,
      sum(cost) as cost,
      sum(margin) as margin
    from priced_shipments
    group by rate_card_id, rate_card_version_id, rate_card_name_snapshot,
      version_number_snapshot, currency
  ),
  alert_candidates as (
    select
      priced.*,
      client.client_type,
      client.business_name,
      client.first_name,
      client.last_name,
      coalesce(round(100.0 * priced.margin / nullif(priced.revenue, 0), 1), 0) as margin_rate,
      case when priced.margin < 0 then 'negative' else 'low' end as severity
    from priced_shipments as priced
    left join public.clients as client
      on client.id = priced.client_id and client.company_id = target_company_id
    where priced.margin < 0
       or (
         priced.revenue > 0
         and 100.0 * priced.margin / priced.revenue < low_margin_threshold
       )
  )
  select jsonb_build_object(
    'lowMarginThreshold', low_margin_threshold,
    'alertCount', (select count(*) from alert_candidates),
    'rateCardVersions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rateCardId', rate_card_id,
        'rateCardVersionId', rate_card_version_id,
        'rateCardName', rate_card_name_snapshot,
        'versionNumber', version_number_snapshot,
        'currency', currency,
        'shipmentCount', shipment_count,
        'revenue', round(revenue, 2),
        'cost', round(cost, 2),
        'margin', round(margin, 2),
        'marginRate', coalesce(round(100.0 * margin / nullif(revenue, 0), 1), 0),
        'averageTicket', coalesce(round(revenue / nullif(shipment_count, 0), 2), 0)
      ) order by currency, rate_card_name_snapshot, version_number_snapshot desc)
      from version_profitability
    ), '[]'::jsonb),
    'marginAlerts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'shipmentId', shipment_id,
        'trackingNumber', tracking_number,
        'shipmentDate', shipment_date,
        'clientId', client_id,
        'clientName', case
          when client_type = 'company' then coalesce(business_name, 'Empresa sin nombre')
          else coalesce(
            nullif(btrim(concat_ws(' ', first_name, last_name)), ''),
            'Cliente sin nombre'
          )
        end,
        'rateCardName', rate_card_name_snapshot,
        'versionNumber', version_number_snapshot,
        'currency', currency,
        'revenue', round(revenue, 2),
        'cost', round(cost, 2),
        'margin', round(margin, 2),
        'marginRate', margin_rate,
        'severity', severity
      ) order by
        case severity when 'negative' then 1 else 2 end,
        margin_rate,
        shipment_date desc)
      from (
        select ranked.*
        from (
          select candidate.*, row_number() over (
            partition by currency
            order by
              case severity when 'negative' then 1 else 2 end,
              margin_rate,
              shipment_date desc
          ) as alert_position
          from alert_candidates as candidate
        ) as ranked
        where alert_position <= 12
      ) as limited_alerts
    ), '[]'::jsonb)
  ) into result;

  return result;
end
$$;

revoke all on function public.get_authorized_pricing_profitability_insights(
  date, date, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.get_authorized_pricing_profitability_insights(
  date, date, text, uuid, uuid, text
) to authenticated;

commit;

-- Phase 8.2: optional shipment pricing inputs, append-only calculation
-- snapshots, explainable line items, and transactional pricing during movement
-- creation/update. Existing unpriced movements remain valid.

begin;

alter table public.shipments
  add column if not exists package_count integer not null default 1,
  add column if not exists weight_kg numeric(14, 3) not null default 0,
  add column if not exists volume_m3 numeric(14, 4) not null default 0,
  add column if not exists declared_value numeric(18, 2) not null default 0,
  add column if not exists distance_km numeric(14, 3) not null default 0,
  add column if not exists is_urgent boolean not null default false,
  add column if not exists selected_rate_card_id uuid references public.rate_cards(id) on delete restrict;

alter table public.shipments
  add constraint shipments_pricing_inputs_check
  check (
    package_count between 1 and 1000000
    and weight_kg between 0 and 1000000000
    and volume_m3 between 0 and 1000000000
    and declared_value between 0 and 1000000000000
    and distance_km between 0 and 1000000000
  );

create table public.shipment_pricing_calculations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  calculation_sequence integer not null,
  calculation_reason varchar(30) not null,
  rate_card_id uuid not null references public.rate_cards(id) on delete restrict,
  rate_card_version_id uuid not null references public.rate_card_versions(id) on delete restrict,
  rate_card_name_snapshot varchar(100) not null,
  version_number_snapshot integer not null,
  currency char(3) not null,
  inputs jsonb not null,
  charge_total numeric(18, 2) not null,
  discount_total numeric(18, 2) not null,
  customer_total numeric(18, 2) not null,
  internal_cost_total numeric(18, 2) not null,
  commission_total numeric(18, 2) not null,
  calculated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint shipment_pricing_calculations_sequence_check
    check (calculation_sequence > 0),
  constraint shipment_pricing_calculations_reason_check
    check (calculation_reason in ('creation', 'movement_update', 'manual_recalculation')),
  constraint shipment_pricing_calculations_currency_check
    check (currency in ('ARS', 'USD', 'EUR', 'BRL')),
  constraint shipment_pricing_calculations_inputs_check
    check (jsonb_typeof(inputs) = 'object'),
  constraint shipment_pricing_calculations_totals_check
    check (
      charge_total >= 0 and discount_total >= 0 and customer_total >= 0
      and internal_cost_total >= 0 and commission_total >= 0
    )
);

create unique index shipment_pricing_calculations_sequence_key
  on public.shipment_pricing_calculations (shipment_id, calculation_sequence);
create index shipment_pricing_calculations_company_created_idx
  on public.shipment_pricing_calculations (company_id, created_at desc);
create index shipment_pricing_calculations_version_idx
  on public.shipment_pricing_calculations (rate_card_version_id, created_at desc);

create table public.shipment_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  calculation_id uuid not null references public.shipment_pricing_calculations(id) on delete restrict,
  line_number integer not null,
  pricing_rule_id uuid references public.pricing_rules(id) on delete set null,
  concept_id uuid references public.economic_concepts(id) on delete set null,
  concept_name_snapshot varchar(100) not null,
  rule_name_snapshot varchar(120) not null,
  category varchar(20) not null,
  calculation_type varchar(20) not null,
  amount numeric(18, 2) not null,
  created_at timestamptz not null default now(),
  constraint shipment_charges_line_check check (line_number > 0),
  constraint shipment_charges_category_check
    check (category in ('charge', 'discount', 'cost', 'commission')),
  constraint shipment_charges_calculation_type_check
    check (calculation_type in ('fixed', 'percentage', 'formula'))
);

create unique index shipment_charges_calculation_line_key
  on public.shipment_charges (calculation_id, line_number);
create index shipment_charges_company_shipment_idx
  on public.shipment_charges (company_id, shipment_id, created_at);

alter table public.shipments
  add column if not exists current_pricing_calculation_id uuid
    references public.shipment_pricing_calculations(id) on delete restrict;

create unique index shipments_current_pricing_calculation_key
  on public.shipments (current_pricing_calculation_id)
  where current_pricing_calculation_id is not null;

alter table public.shipment_pricing_calculations enable row level security;
alter table public.shipment_pricing_calculations force row level security;
alter table public.shipment_charges enable row level security;
alter table public.shipment_charges force row level security;

create policy shipment_pricing_calculations_select_permitted
on public.shipment_pricing_calculations for select to authenticated
using (app_private.has_permission(company_id, 'pricing.view'));

create policy shipment_charges_select_permitted
on public.shipment_charges for select to authenticated
using (app_private.has_permission(company_id, 'pricing.view'));

revoke all on table public.shipment_pricing_calculations from anon, authenticated;
revoke all on table public.shipment_charges from anon, authenticated;
grant select on table public.shipment_pricing_calculations to authenticated;
grant select on table public.shipment_charges to authenticated;

create or replace function app_private.resolve_published_rate_card_version(
  target_company_id uuid,
  target_rate_card_id uuid,
  requested_shipment_date date
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select version.id
  from public.rate_cards as rate_card
  join public.rate_card_versions as version
    on version.rate_card_id = rate_card.id
   and version.company_id = rate_card.company_id
  where rate_card.id = target_rate_card_id
    and rate_card.company_id = target_company_id
    and rate_card.is_active
    and version.status = 'published'
    and version.effective_from <= requested_shipment_date
    and (version.effective_to is null or version.effective_to >= requested_shipment_date)
  order by version.version_number desc
  limit 1
$$;

revoke all on function app_private.resolve_published_rate_card_version(
  uuid, uuid, date
) from public, anon, authenticated;

-- Shipment operators may simulate a published version returned by the
-- shipment-pricing options RPC. Draft simulation still requires pricing.manage.
create or replace function public.simulate_pricing(
  target_version_id uuid,
  requested_inputs jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  selected_version public.rate_card_versions%rowtype;
  rule_data record;
  normalized_inputs jsonb;
  calculated_amount numeric;
  signed_amount numeric;
  customer_subtotal numeric := 0;
  charge_total numeric := 0;
  discount_total numeric := 0;
  internal_cost_total numeric := 0;
  commission_total numeric := 0;
  line_items jsonb := '[]'::jsonb;
  applies boolean;
begin
  if target_company_id is null or not (
    app_private.has_permission(target_company_id, 'pricing.view')
    or app_private.has_permission(target_company_id, 'shipments.create')
    or app_private.has_permission(target_company_id, 'shipments.update')
  ) then
    raise exception using errcode = '42501', message = 'No tienes permiso para calcular valores económicos.';
  end if;

  select * into selected_version from public.rate_card_versions
  where id = target_version_id and company_id = target_company_id;

  if selected_version.id is null
     or (
       selected_version.status = 'draft'
       and not app_private.has_permission(target_company_id, 'pricing.manage')
     ) then
    raise exception using errcode = '42501', message = 'Esta versión tarifaria no está disponible para calcular.';
  end if;

  normalized_inputs := jsonb_build_object(
    'client_id', nullif(btrim(requested_inputs ->> 'clientId'), ''),
    'zone_id', nullif(btrim(requested_inputs ->> 'zoneId'), ''),
    'destination_place_id', nullif(btrim(requested_inputs ->> 'destinationPlaceId'), ''),
    'package_count', greatest(coalesce((requested_inputs ->> 'packageCount')::numeric, 1), 0),
    'weight_kg', greatest(coalesce((requested_inputs ->> 'weightKg')::numeric, 0), 0),
    'volume_m3', greatest(coalesce((requested_inputs ->> 'volumeM3')::numeric, 0), 0),
    'declared_value', greatest(coalesce((requested_inputs ->> 'declaredValue')::numeric, 0), 0),
    'distance_km', greatest(coalesce((requested_inputs ->> 'distanceKm')::numeric, 0), 0),
    'urgency', coalesce((requested_inputs ->> 'urgency')::boolean, false),
    'weekend', coalesce((requested_inputs ->> 'weekend')::boolean, false)
  );

  if (normalized_inputs ->> 'package_count')::numeric > 1000000
     or (normalized_inputs ->> 'weight_kg')::numeric > 1000000000
     or (normalized_inputs ->> 'volume_m3')::numeric > 1000000000
     or (normalized_inputs ->> 'declared_value')::numeric > 1000000000000
     or (normalized_inputs ->> 'distance_km')::numeric > 1000000000 then
    raise exception using errcode = '22023', message = 'Uno o más valores superan el máximo permitido.';
  end if;

  for rule_data in
    select rule.*
    from public.pricing_rules as rule
    where rule.rate_card_version_id = target_version_id
      and rule.is_active
    order by rule.priority, rule.created_at
  loop
    applies := true;

    if rule_data.conditions ? 'urgency' then
      applies := applies and (rule_data.conditions ->> 'urgency')::boolean
        = (normalized_inputs ->> 'urgency')::boolean;
    end if;
    if rule_data.conditions ? 'weekend' then
      applies := applies and (rule_data.conditions ->> 'weekend')::boolean
        = (normalized_inputs ->> 'weekend')::boolean;
    end if;
    if rule_data.conditions ? 'minimumPackageCount' then
      applies := applies and (normalized_inputs ->> 'package_count')::numeric
        >= (rule_data.conditions ->> 'minimumPackageCount')::numeric;
    end if;
    if rule_data.conditions ? 'minimumWeightKg' then
      applies := applies and (normalized_inputs ->> 'weight_kg')::numeric
        >= (rule_data.conditions ->> 'minimumWeightKg')::numeric;
    end if;
    if rule_data.conditions ? 'minimumVolumeM3' then
      applies := applies and (normalized_inputs ->> 'volume_m3')::numeric
        >= (rule_data.conditions ->> 'minimumVolumeM3')::numeric;
    end if;
    if rule_data.conditions ? 'minimumDeclaredValue' then
      applies := applies and (normalized_inputs ->> 'declared_value')::numeric
        >= (rule_data.conditions ->> 'minimumDeclaredValue')::numeric;
    end if;
    if rule_data.conditions ? 'minimumDistanceKm' then
      applies := applies and (normalized_inputs ->> 'distance_km')::numeric
        >= (rule_data.conditions ->> 'minimumDistanceKm')::numeric;
    end if;

    applies := applies and (
      not exists (
        select 1 from public.pricing_rule_scopes
        where pricing_rule_id = rule_data.id and scope_type = 'client'
      ) or exists (
        select 1 from public.pricing_rule_scopes
        where pricing_rule_id = rule_data.id and scope_type = 'client'
          and scope_key = (normalized_inputs ->> 'client_id')
      )
    ) and (
      not exists (
        select 1 from public.pricing_rule_scopes
        where pricing_rule_id = rule_data.id and scope_type = 'zone'
      ) or exists (
        select 1 from public.pricing_rule_scopes
        where pricing_rule_id = rule_data.id and scope_type = 'zone'
          and scope_key = (normalized_inputs ->> 'zone_id')
      )
    ) and (
      not exists (
        select 1 from public.pricing_rule_scopes
        where pricing_rule_id = rule_data.id and scope_type = 'destination'
      ) or exists (
        select 1 from public.pricing_rule_scopes
        where pricing_rule_id = rule_data.id and scope_type = 'destination'
          and scope_key = (normalized_inputs ->> 'destination_place_id')
      )
    );

    if not applies then continue; end if;

    normalized_inputs := normalized_inputs || jsonb_build_object('subtotal', customer_subtotal);
    calculated_amount := case rule_data.calculation_type
      when 'fixed' then rule_data.fixed_amount
      when 'percentage' then customer_subtotal * rule_data.percentage / 100
      when 'formula' then app_private.evaluate_pricing_expression(rule_data.formula, normalized_inputs)
    end;
    calculated_amount := abs(calculated_amount);
    if calculated_amount > 1000000000000 then
      raise exception using errcode = '22003', message = 'Una regla supera el importe máximo admitido.';
    end if;
    if rule_data.minimum_amount is not null then
      calculated_amount := greatest(calculated_amount, rule_data.minimum_amount);
    end if;
    if rule_data.maximum_amount is not null then
      calculated_amount := least(calculated_amount, rule_data.maximum_amount);
    end if;
    calculated_amount := round(calculated_amount, 2);
    signed_amount := case when rule_data.concept_category_snapshot = 'discount' then -calculated_amount else calculated_amount end;

    if rule_data.concept_category_snapshot = 'charge' then
      charge_total := charge_total + calculated_amount;
      customer_subtotal := customer_subtotal + calculated_amount;
    elsif rule_data.concept_category_snapshot = 'discount' then
      discount_total := discount_total + calculated_amount;
      customer_subtotal := customer_subtotal - calculated_amount;
    elsif rule_data.concept_category_snapshot = 'cost' then
      internal_cost_total := internal_cost_total + calculated_amount;
    elsif rule_data.concept_category_snapshot = 'commission' then
      commission_total := commission_total + calculated_amount;
    end if;

    line_items := line_items || jsonb_build_array(jsonb_build_object(
      'ruleId', rule_data.id,
      'conceptId', rule_data.concept_id,
      'conceptName', rule_data.concept_name_snapshot,
      'ruleName', rule_data.name,
      'category', rule_data.concept_category_snapshot,
      'calculationType', rule_data.calculation_type,
      'amount', signed_amount
    ));

    if not rule_data.is_cumulative then exit; end if;
  end loop;

  return jsonb_build_object(
    'rateCardVersionId', selected_version.id,
    'versionNumber', selected_version.version_number,
    'currency', btrim(selected_version.currency),
    'inputs', normalized_inputs - 'subtotal',
    'lineItems', line_items,
    'chargeTotal', round(charge_total, 2),
    'discountTotal', round(discount_total, 2),
    'customerTotal', round(greatest(customer_subtotal, 0), 2),
    'internalCostTotal', round(internal_cost_total, 2),
    'commissionTotal', round(commission_total, 2)
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'El cálculo contiene valores numéricos inválidos.';
end
$$;

create or replace function public.get_shipment_pricing_options(
  requested_shipment_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  result jsonb;
begin
  if target_company_id is null or not (
    app_private.has_permission(target_company_id, 'shipments.create')
    or app_private.has_permission(target_company_id, 'shipments.update')
  ) then
    raise exception using errcode = '42501', message = 'No tienes permiso para valorizar movimientos.';
  end if;

  if requested_shipment_date is null then
    raise exception using errcode = '22023', message = 'La fecha del movimiento es obligatoria.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'rateCardId', rate_card.id,
    'rateCardName', rate_card.name,
    'versionId', version.id,
    'versionNumber', version.version_number,
    'currency', btrim(version.currency)
  ) order by rate_card.name), '[]'::jsonb)
  into result
  from public.rate_cards as rate_card
  join public.rate_card_versions as version
    on version.rate_card_id = rate_card.id
   and version.company_id = rate_card.company_id
  where rate_card.company_id = target_company_id
    and rate_card.is_active
    and version.status = 'published'
    and version.effective_from <= requested_shipment_date
    and (version.effective_to is null or version.effective_to >= requested_shipment_date);

  return result;
end
$$;

create or replace function public.preview_shipment_pricing(
  target_rate_card_id uuid,
  requested_shipment_date date,
  shipment_client_id uuid,
  shipment_zone_id uuid,
  shipment_destination_place_id text,
  requested_package_count integer,
  requested_weight_kg numeric,
  requested_volume_m3 numeric,
  requested_declared_value numeric,
  requested_distance_km numeric,
  requested_is_urgent boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  resolved_version_id uuid;
  result jsonb;
begin
  if target_company_id is null or not (
    app_private.has_permission(target_company_id, 'shipments.create')
    or app_private.has_permission(target_company_id, 'shipments.update')
  ) then
    raise exception using errcode = '42501', message = 'No tienes permiso para valorizar movimientos.';
  end if;

  if not exists (
    select 1 from public.clients
    where id = shipment_client_id and company_id = target_company_id
  ) then
    raise exception using errcode = '22023', message = 'Selecciona un cliente válido de esta empresa.';
  end if;

  if shipment_zone_id is not null and not exists (
    select 1 from public.zones
    where id = shipment_zone_id and company_id = target_company_id
  ) then
    raise exception using errcode = '22023', message = 'La zona seleccionada no pertenece a esta empresa.';
  end if;

  resolved_version_id := app_private.resolve_published_rate_card_version(
    target_company_id, target_rate_card_id, requested_shipment_date
  );
  if resolved_version_id is null then
    raise exception using errcode = '22023', message = 'La lista no tiene una versión vigente para la fecha seleccionada.';
  end if;

  result := public.simulate_pricing(resolved_version_id, jsonb_build_object(
    'clientId', shipment_client_id,
    'zoneId', shipment_zone_id,
    'destinationPlaceId', nullif(btrim(shipment_destination_place_id), ''),
    'packageCount', requested_package_count,
    'weightKg', requested_weight_kg,
    'volumeM3', requested_volume_m3,
    'declaredValue', requested_declared_value,
    'distanceKm', requested_distance_km,
    'urgency', coalesce(requested_is_urgent, false),
    'weekend', extract(isodow from requested_shipment_date) in (6, 7)
  ));

  return result || jsonb_build_object('rateCardId', target_rate_card_id);
end
$$;

create or replace function public.save_priced_shipment_with_destination(
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
  city_longitude double precision,
  target_rate_card_id uuid,
  requested_package_count integer,
  requested_weight_kg numeric,
  requested_volume_m3 numeric,
  requested_declared_value numeric,
  requested_distance_km numeric,
  requested_is_urgent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  required_permission text := case
    when target_shipment_id is null then 'shipments.create'
    else 'shipments.update'
  end;
  saved_shipment jsonb;
  saved_shipment_id uuid;
  resolved_zone_id uuid;
  resolved_version_id uuid;
  selected_card public.rate_cards%rowtype;
  selected_version public.rate_card_versions%rowtype;
  calculation_result jsonb;
  calculation_id uuid;
  next_sequence integer;
  line_item jsonb;
  line_number integer := 0;
  previous_calculation_id uuid;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, required_permission) then
    raise exception using errcode = '42501', message = 'No tienes permiso para guardar este movimiento.';
  end if;

  if coalesce(requested_package_count, 0) not between 1 and 1000000
     or coalesce(requested_weight_kg, -1) not between 0 and 1000000000
     or coalesce(requested_volume_m3, -1) not between 0 and 1000000000
     or coalesce(requested_declared_value, -1) not between 0 and 1000000000000
     or coalesce(requested_distance_km, -1) not between 0 and 1000000000 then
    raise exception using errcode = '22023', message = 'Revisa los datos económicos del movimiento.';
  end if;

  if not exists (
    select 1 from public.clients
    where id = shipment_client_id and company_id = target_company_id
  ) then
    raise exception using errcode = '22023', message = 'Selecciona un cliente válido de esta empresa.';
  end if;

  saved_shipment := public.save_shipment_with_destination(
    target_shipment_id,
    shipment_tracking_number,
    shipment_client_id,
    shipment_delivery_address,
    shipment_status,
    requested_shipment_date,
    city_name,
    city_mapbox_place_id,
    city_place_label,
    city_latitude,
    city_longitude
  );
  saved_shipment_id := (saved_shipment ->> 'id')::uuid;
  resolved_zone_id := nullif(saved_shipment ->> 'zone_id', '')::uuid;

  select current_pricing_calculation_id
  into previous_calculation_id
  from public.shipments
  where id = saved_shipment_id
  for update;

  update public.shipments
  set package_count = requested_package_count,
      weight_kg = requested_weight_kg,
      volume_m3 = requested_volume_m3,
      declared_value = requested_declared_value,
      distance_km = requested_distance_km,
      is_urgent = coalesce(requested_is_urgent, false),
      selected_rate_card_id = target_rate_card_id,
      current_pricing_calculation_id = case
        when target_rate_card_id is null then null
        else current_pricing_calculation_id
      end
  where id = saved_shipment_id;

  if target_rate_card_id is not null then
    resolved_version_id := app_private.resolve_published_rate_card_version(
      target_company_id, target_rate_card_id, requested_shipment_date
    );
    if resolved_version_id is null then
      raise exception using errcode = '22023', message = 'La lista no tiene una versión vigente para la fecha seleccionada.';
    end if;

    select * into selected_card from public.rate_cards
    where id = target_rate_card_id and company_id = target_company_id;
    select * into selected_version from public.rate_card_versions
    where id = resolved_version_id and company_id = target_company_id;

    calculation_result := public.simulate_pricing(resolved_version_id, jsonb_build_object(
      'clientId', shipment_client_id,
      'zoneId', resolved_zone_id,
      'destinationPlaceId', city_mapbox_place_id,
      'packageCount', requested_package_count,
      'weightKg', requested_weight_kg,
      'volumeM3', requested_volume_m3,
      'declaredValue', requested_declared_value,
      'distanceKm', requested_distance_km,
      'urgency', coalesce(requested_is_urgent, false),
      'weekend', extract(isodow from requested_shipment_date) in (6, 7)
    ));

    select coalesce(max(calculation_sequence), 0) + 1
    into next_sequence
    from public.shipment_pricing_calculations
    where shipment_id = saved_shipment_id;

    insert into public.shipment_pricing_calculations (
      company_id, shipment_id, calculation_sequence, calculation_reason,
      rate_card_id, rate_card_version_id, rate_card_name_snapshot,
      version_number_snapshot, currency, inputs, charge_total, discount_total,
      customer_total, internal_cost_total, commission_total, calculated_by
    ) values (
      target_company_id,
      saved_shipment_id,
      next_sequence,
      case when target_shipment_id is null then 'creation' else 'movement_update' end,
      target_rate_card_id,
      resolved_version_id,
      selected_card.name,
      selected_version.version_number,
      btrim(selected_version.currency),
      calculation_result -> 'inputs',
      (calculation_result ->> 'chargeTotal')::numeric,
      (calculation_result ->> 'discountTotal')::numeric,
      (calculation_result ->> 'customerTotal')::numeric,
      (calculation_result ->> 'internalCostTotal')::numeric,
      (calculation_result ->> 'commissionTotal')::numeric,
      auth.uid()
    ) returning id into calculation_id;

    for line_item in
      select value from jsonb_array_elements(calculation_result -> 'lineItems')
    loop
      line_number := line_number + 1;
      insert into public.shipment_charges (
        company_id, shipment_id, calculation_id, line_number,
        pricing_rule_id, concept_id, concept_name_snapshot, rule_name_snapshot,
        category, calculation_type, amount
      ) values (
        target_company_id,
        saved_shipment_id,
        calculation_id,
        line_number,
        (line_item ->> 'ruleId')::uuid,
        (line_item ->> 'conceptId')::uuid,
        line_item ->> 'conceptName',
        line_item ->> 'ruleName',
        line_item ->> 'category',
        line_item ->> 'calculationType',
        (line_item ->> 'amount')::numeric
      );
    end loop;

    update public.shipments
    set current_pricing_calculation_id = calculation_id
    where id = saved_shipment_id;

    insert into public.audit_events (
      company_id, actor_profile_id, action, entity_type, entity_id,
      previous_data, new_data
    ) values (
      target_company_id,
      auth.uid(),
      'shipment.priced',
      'shipment',
      saved_shipment_id,
      jsonb_build_object('calculationId', previous_calculation_id),
      jsonb_build_object(
        'calculationId', calculation_id,
        'rateCardVersionId', resolved_version_id,
        'customerTotal', calculation_result -> 'customerTotal',
        'currency', calculation_result -> 'currency'
      )
    );
  elsif previous_calculation_id is not null then
    insert into public.audit_events (
      company_id, actor_profile_id, action, entity_type, entity_id,
      previous_data, new_data
    ) values (
      target_company_id,
      auth.uid(),
      'shipment.pricing_detached',
      'shipment',
      saved_shipment_id,
      jsonb_build_object('calculationId', previous_calculation_id),
      jsonb_build_object('calculationId', null)
    );
  end if;

  select to_jsonb(shipment)
  into saved_shipment
  from public.shipments as shipment
  where shipment.id = saved_shipment_id;

  return saved_shipment || jsonb_build_object('pricingSummary', calculation_result);
end
$$;

create or replace function public.get_current_shipment_pricing_summaries()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  result jsonb;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'pricing.view') then
    raise exception using errcode = '42501', message = 'No tienes permiso para ver importes económicos.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shipmentId', shipment.id,
    'calculationId', calculation.id,
    'rateCardName', calculation.rate_card_name_snapshot,
    'versionNumber', calculation.version_number_snapshot,
    'currency', btrim(calculation.currency),
    'customerTotal', calculation.customer_total,
    'internalCostTotal', calculation.internal_cost_total,
    'commissionTotal', calculation.commission_total,
    'calculatedAt', calculation.created_at
  )), '[]'::jsonb)
  into result
  from public.shipments as shipment
  join public.shipment_pricing_calculations as calculation
    on calculation.id = shipment.current_pricing_calculation_id
   and calculation.shipment_id = shipment.id
   and calculation.company_id = shipment.company_id
  where shipment.company_id = target_company_id;

  return result;
end
$$;

create or replace function public.delete_authorized_shipment(target_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'shipments.delete') then
    raise exception using errcode = '42501', message = 'No tienes permiso para eliminar este movimiento.';
  end if;

  if exists (
    select 1 from public.shipment_pricing_calculations
    where shipment_id = target_shipment_id and company_id = target_company_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Un movimiento valorizado conserva historial económico y no puede eliminarse.';
  end if;

  delete from public.shipments
  where id = target_shipment_id and company_id = target_company_id;

  if not found then
    raise exception using errcode = '22023', message = 'El movimiento no existe o no pertenece a esta empresa.';
  end if;
end
$$;

revoke all on function public.simulate_pricing(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.get_shipment_pricing_options(date)
  from public, anon, authenticated;
revoke all on function public.preview_shipment_pricing(
  uuid, date, uuid, uuid, text, integer, numeric, numeric, numeric, numeric, boolean
) from public, anon, authenticated;
revoke all on function public.save_priced_shipment_with_destination(
  uuid, text, uuid, text, text, date, text, text, text,
  double precision, double precision, uuid, integer, numeric, numeric,
  numeric, numeric, boolean
) from public, anon, authenticated;
revoke all on function public.get_current_shipment_pricing_summaries()
  from public, anon, authenticated;
revoke all on function public.delete_authorized_shipment(uuid)
  from public, anon, authenticated;

-- Superseded browser mutation paths must not bypass snapshot creation.
revoke all on function public.save_authorized_shipment_with_destination(
  uuid, text, uuid, text, text, date, text, text, text,
  double precision, double precision
) from public, anon, authenticated;
revoke delete on table public.shipments from authenticated;

grant execute on function public.simulate_pricing(uuid, jsonb) to authenticated;
grant execute on function public.get_shipment_pricing_options(date) to authenticated;
grant execute on function public.preview_shipment_pricing(
  uuid, date, uuid, uuid, text, integer, numeric, numeric, numeric, numeric, boolean
) to authenticated;
grant execute on function public.save_priced_shipment_with_destination(
  uuid, text, uuid, text, text, date, text, text, text,
  double precision, double precision, uuid, integer, numeric, numeric,
  numeric, numeric, boolean
) to authenticated;
grant execute on function public.get_current_shipment_pricing_summaries()
  to authenticated;
grant execute on function public.delete_authorized_shipment(uuid) to authenticated;

commit;

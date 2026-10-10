-- Phase 8.5: advanced safe formula variables and server-derived client/zone
-- conditions. No existing rule or immutable shipment snapshot is rewritten.

begin;

create or replace function app_private.is_valid_pricing_expression(
  expression jsonb,
  expression_depth integer default 0
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  operator_name text;
  argument jsonb;
  argument_count integer;
begin
  if expression is null or jsonb_typeof(expression) <> 'object'
     or expression_depth > 8 then
    return false;
  end if;

  operator_name := expression ->> 'op';
  if operator_name = 'constant' then
    return jsonb_typeof(expression -> 'value') = 'number'
      and abs((expression ->> 'value')::numeric) <= 1000000000;
  end if;

  if operator_name = 'variable' then
    return (expression ->> 'name') in (
      'subtotal', 'base_price', 'package_count', 'weight_kg', 'volume_m3',
      'declared_value', 'distance_km', 'urgency_flag', 'weekend_flag',
      'client_is_company'
    );
  end if;

  if operator_name not in ('add', 'subtract', 'multiply', 'divide', 'min', 'max')
     or jsonb_typeof(expression -> 'args') <> 'array' then
    return false;
  end if;

  argument_count := jsonb_array_length(expression -> 'args');
  if argument_count <> 2 then
    return false;
  end if;

  for argument in select value from jsonb_array_elements(expression -> 'args')
  loop
    if not app_private.is_valid_pricing_expression(argument, expression_depth + 1) then
      return false;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end
$$;

create or replace function app_private.validate_pricing_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(new.description), '');
  new.conditions := coalesce(new.conditions, '{}'::jsonb);
  new.tax_behavior := coalesce(new.tax_behavior, 'none');
  new.tax_label := nullif(btrim(new.tax_label), '');

  if not exists (
    select 1 from public.rate_card_versions as version
    where version.id = new.rate_card_version_id
      and version.company_id = new.company_id
      and version.status = 'draft'
  ) then
    raise exception using errcode = '23514', message = 'Las reglas sólo pueden modificarse en una versión borrador de la empresa.';
  end if;

  select concept.name, concept.category
  into new.concept_name_snapshot, new.concept_category_snapshot
  from public.economic_concepts as concept
  where concept.id = new.concept_id
    and concept.company_id = new.company_id
    and concept.is_active;

  if new.concept_name_snapshot is null then
    raise exception using errcode = '23514', message = 'Selecciona un concepto económico activo de esta empresa.';
  end if;

  if new.tax_behavior <> 'none' and new.concept_category_snapshot <> 'charge' then
    raise exception using errcode = '23514', message = 'Los impuestos sólo pueden configurarse sobre conceptos de cargo al cliente.';
  end if;

  if new.calculation_type = 'formula'
     and not app_private.is_valid_pricing_expression(new.formula) then
    raise exception using errcode = '23514', message = 'La fórmula contiene operaciones o variables no admitidas.';
  end if;

  if (new.conditions - array[
    'urgency', 'weekend', 'clientType', 'zoneType',
    'minimumPackageCount', 'minimumWeightKg', 'minimumVolumeM3',
    'minimumDeclaredValue', 'minimumDistanceKm'
  ]) <> '{}'::jsonb then
    raise exception using errcode = '23514', message = 'La regla contiene una condición no admitida.';
  end if;

  if (new.conditions ? 'urgency' and jsonb_typeof(new.conditions -> 'urgency') <> 'boolean')
     or (new.conditions ? 'weekend' and jsonb_typeof(new.conditions -> 'weekend') <> 'boolean')
     or (new.conditions ? 'clientType' and (
       jsonb_typeof(new.conditions -> 'clientType') <> 'string'
       or (new.conditions ->> 'clientType') not in ('company', 'individual')
     ))
     or (new.conditions ? 'zoneType' and (
       jsonb_typeof(new.conditions -> 'zoneType') <> 'string'
       or (new.conditions ->> 'zoneType') not in ('group', 'city')
     ))
     or (new.conditions ? 'minimumPackageCount' and (
       jsonb_typeof(new.conditions -> 'minimumPackageCount') <> 'number'
       or (new.conditions ->> 'minimumPackageCount')::numeric < 0
     ))
     or (new.conditions ? 'minimumWeightKg' and (
       jsonb_typeof(new.conditions -> 'minimumWeightKg') <> 'number'
       or (new.conditions ->> 'minimumWeightKg')::numeric < 0
     ))
     or (new.conditions ? 'minimumVolumeM3' and (
       jsonb_typeof(new.conditions -> 'minimumVolumeM3') <> 'number'
       or (new.conditions ->> 'minimumVolumeM3')::numeric < 0
     ))
     or (new.conditions ? 'minimumDeclaredValue' and (
       jsonb_typeof(new.conditions -> 'minimumDeclaredValue') <> 'number'
       or (new.conditions ->> 'minimumDeclaredValue')::numeric < 0
     ))
     or (new.conditions ? 'minimumDistanceKm' and (
       jsonb_typeof(new.conditions -> 'minimumDistanceKm') <> 'number'
       or (new.conditions ->> 'minimumDistanceKm')::numeric < 0
     )) then
    raise exception using errcode = '23514', message = 'La regla contiene un valor de condición inválido.';
  end if;

  return new;
end
$$;

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
  requested_client_id uuid;
  requested_zone_id uuid;
  selected_client_type text;
  selected_zone_type text;
  calculated_amount numeric;
  gross_amount numeric;
  net_amount numeric;
  tax_amount numeric;
  signed_amount numeric;
  signed_net_amount numeric;
  customer_subtotal numeric := 0;
  charge_total numeric := 0;
  discount_total numeric := 0;
  internal_cost_total numeric := 0;
  commission_total numeric := 0;
  tax_total numeric := 0;
  included_tax_total numeric := 0;
  added_tax_total numeric := 0;
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
     or (selected_version.status = 'draft'
       and not app_private.has_permission(target_company_id, 'pricing.manage')) then
    raise exception using errcode = '42501', message = 'Esta versión tarifaria no está disponible para calcular.';
  end if;

  requested_client_id := nullif(btrim(requested_inputs ->> 'clientId'), '')::uuid;
  requested_zone_id := nullif(btrim(requested_inputs ->> 'zoneId'), '')::uuid;

  if requested_client_id is not null then
    select client.client_type
    into selected_client_type
    from public.clients as client
    where client.id = requested_client_id
      and client.company_id = target_company_id;
  end if;

  if requested_zone_id is not null then
    select zone.zone_type
    into selected_zone_type
    from public.zones as zone
    where zone.id = requested_zone_id
      and zone.company_id = target_company_id;
  end if;

  normalized_inputs := jsonb_build_object(
    'client_id', requested_client_id,
    'client_type', selected_client_type,
    'client_is_company', case when selected_client_type = 'company' then 1 else 0 end,
    'zone_id', requested_zone_id,
    'zone_type', selected_zone_type,
    'destination_place_id', nullif(btrim(requested_inputs ->> 'destinationPlaceId'), ''),
    'package_count', greatest(coalesce((requested_inputs ->> 'packageCount')::numeric, 1), 0),
    'weight_kg', greatest(coalesce((requested_inputs ->> 'weightKg')::numeric, 0), 0),
    'volume_m3', greatest(coalesce((requested_inputs ->> 'volumeM3')::numeric, 0), 0),
    'declared_value', greatest(coalesce((requested_inputs ->> 'declaredValue')::numeric, 0), 0),
    'distance_km', greatest(coalesce((requested_inputs ->> 'distanceKm')::numeric, 0), 0),
    'urgency', coalesce((requested_inputs ->> 'urgency')::boolean, false),
    'urgency_flag', case when coalesce((requested_inputs ->> 'urgency')::boolean, false) then 1 else 0 end,
    'weekend', coalesce((requested_inputs ->> 'weekend')::boolean, false),
    'weekend_flag', case when coalesce((requested_inputs ->> 'weekend')::boolean, false) then 1 else 0 end
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
    if rule_data.conditions ? 'clientType' then
      applies := applies and (rule_data.conditions ->> 'clientType')
        = (normalized_inputs ->> 'client_type');
    end if;
    if rule_data.conditions ? 'zoneType' then
      applies := applies and (rule_data.conditions ->> 'zoneType')
        = (normalized_inputs ->> 'zone_type');
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
      not exists (select 1 from public.pricing_rule_scopes where pricing_rule_id = rule_data.id and scope_type = 'client')
      or exists (select 1 from public.pricing_rule_scopes where pricing_rule_id = rule_data.id and scope_type = 'client' and scope_key = (normalized_inputs ->> 'client_id'))
    ) and (
      not exists (select 1 from public.pricing_rule_scopes where pricing_rule_id = rule_data.id and scope_type = 'zone')
      or exists (select 1 from public.pricing_rule_scopes where pricing_rule_id = rule_data.id and scope_type = 'zone' and scope_key = (normalized_inputs ->> 'zone_id'))
    ) and (
      not exists (select 1 from public.pricing_rule_scopes where pricing_rule_id = rule_data.id and scope_type = 'destination')
      or exists (select 1 from public.pricing_rule_scopes where pricing_rule_id = rule_data.id and scope_type = 'destination' and scope_key = (normalized_inputs ->> 'destination_place_id'))
    );

    if not applies then continue; end if;

    normalized_inputs := normalized_inputs || jsonb_build_object(
      'subtotal', customer_subtotal,
      'base_price', customer_subtotal
    );
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

    if rule_data.tax_behavior = 'added' then
      gross_amount := round(calculated_amount * (100 + rule_data.tax_rate) / 100, 2);
      tax_amount := round(gross_amount * rule_data.tax_rate / (100 + rule_data.tax_rate), 2);
      net_amount := gross_amount - tax_amount;
    elsif rule_data.tax_behavior = 'included' then
      gross_amount := calculated_amount;
      tax_amount := round(gross_amount * rule_data.tax_rate / (100 + rule_data.tax_rate), 2);
      net_amount := gross_amount - tax_amount;
    else
      gross_amount := calculated_amount;
      tax_amount := 0;
      net_amount := gross_amount;
    end if;

    signed_amount := case when rule_data.concept_category_snapshot = 'discount' then -gross_amount else gross_amount end;
    signed_net_amount := case when rule_data.concept_category_snapshot = 'discount' then -net_amount else net_amount end;

    if rule_data.concept_category_snapshot = 'charge' then
      charge_total := charge_total + gross_amount;
      customer_subtotal := customer_subtotal + gross_amount;
    elsif rule_data.concept_category_snapshot = 'discount' then
      discount_total := discount_total + gross_amount;
      customer_subtotal := customer_subtotal - gross_amount;
    elsif rule_data.concept_category_snapshot = 'cost' then
      internal_cost_total := internal_cost_total + gross_amount;
    elsif rule_data.concept_category_snapshot = 'commission' then
      commission_total := commission_total + gross_amount;
    end if;

    tax_total := tax_total + tax_amount;
    if rule_data.tax_behavior = 'included' then
      included_tax_total := included_tax_total + tax_amount;
    elsif rule_data.tax_behavior = 'added' then
      added_tax_total := added_tax_total + tax_amount;
    end if;

    line_items := line_items || jsonb_build_array(jsonb_build_object(
      'ruleId', rule_data.id,
      'conceptId', rule_data.concept_id,
      'conceptName', rule_data.concept_name_snapshot,
      'ruleName', rule_data.name,
      'category', rule_data.concept_category_snapshot,
      'calculationType', rule_data.calculation_type,
      'amount', signed_amount,
      'netAmount', signed_net_amount,
      'taxAmount', tax_amount,
      'taxBehavior', rule_data.tax_behavior,
      'taxRate', rule_data.tax_rate,
      'taxLabel', rule_data.tax_label
    ));

    if not rule_data.is_cumulative then exit; end if;
  end loop;

  return jsonb_build_object(
    'rateCardVersionId', selected_version.id,
    'versionNumber', selected_version.version_number,
    'currency', btrim(selected_version.currency),
    'inputs', normalized_inputs - 'subtotal' - 'base_price',
    'lineItems', line_items,
    'chargeTotal', round(charge_total, 2),
    'discountTotal', round(discount_total, 2),
    'customerTotal', round(greatest(customer_subtotal, 0), 2),
    'internalCostTotal', round(internal_cost_total, 2),
    'commissionTotal', round(commission_total, 2),
    'taxTotal', round(tax_total, 2),
    'includedTaxTotal', round(included_tax_total, 2),
    'addedTaxTotal', round(added_tax_total, 2)
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'El cálculo contiene identificadores o valores numéricos inválidos.';
end
$$;

revoke all on function app_private.is_valid_pricing_expression(jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.simulate_pricing(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.simulate_pricing(uuid, jsonb) to authenticated;

commit;

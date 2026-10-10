-- Phase 8.4: versioned tax treatment for pricing rules and immutable shipment
-- tax snapshots. Existing calculations remain valid and are treated as untaxed.

begin;

-- Normal movement pricing reads these relations in this order. Taking every
-- DDL lock before altering the first relation avoids lock-order deadlocks with
-- active PostgREST requests.
set local lock_timeout = '30s';
lock table public.shipments in access exclusive mode;
lock table public.pricing_rules in access exclusive mode;
lock table public.shipment_pricing_calculations in access exclusive mode;
lock table public.shipment_charges in access exclusive mode;

alter table public.pricing_rules
  add column tax_behavior varchar(10) not null default 'none',
  add column tax_rate numeric(7, 4),
  add column tax_label varchar(60),
  add constraint pricing_rules_tax_check
  check (
    (tax_behavior = 'none' and tax_rate is null and tax_label is null)
    or (
      tax_behavior in ('included', 'added')
      and tax_rate > 0 and tax_rate <= 100
      and char_length(btrim(tax_label)) between 2 and 60
    )
  );

alter table public.shipment_pricing_calculations
  add column tax_total numeric(18, 2) not null default 0,
  add column included_tax_total numeric(18, 2) not null default 0,
  add column added_tax_total numeric(18, 2) not null default 0,
  add constraint shipment_pricing_calculations_tax_totals_check
  check (
    tax_total >= 0
    and included_tax_total >= 0
    and added_tax_total >= 0
    and tax_total = included_tax_total + added_tax_total
  );

alter table public.shipment_charges
  add column net_amount numeric(18, 2),
  add column tax_amount numeric(18, 2) not null default 0,
  add column tax_behavior varchar(10) not null default 'none',
  add column tax_rate numeric(7, 4),
  add column tax_label varchar(60);

update public.shipment_charges
set net_amount = amount;

alter table public.shipment_charges
  alter column net_amount set not null,
  add constraint shipment_charges_tax_check
  check (
    tax_amount >= 0
    and (
      (tax_behavior = 'none' and tax_amount = 0 and tax_rate is null and tax_label is null)
      or (
        tax_behavior in ('included', 'added')
        and category = 'charge'
        and tax_rate > 0 and tax_rate <= 100
        and char_length(btrim(tax_label)) between 2 and 60
      )
    )
  );

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
    'urgency', 'weekend', 'minimumPackageCount', 'minimumWeightKg',
    'minimumVolumeM3', 'minimumDeclaredValue', 'minimumDistanceKm'
  ]) <> '{}'::jsonb then
    raise exception using errcode = '23514', message = 'La regla contiene una condición no admitida.';
  end if;

  if (new.conditions ? 'urgency' and jsonb_typeof(new.conditions -> 'urgency') <> 'boolean')
     or (new.conditions ? 'weekend' and jsonb_typeof(new.conditions -> 'weekend') <> 'boolean')
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

create or replace function public.get_pricing_workspace()
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
    raise exception using errcode = '42501', message = 'No tienes permiso para consultar valores económicos.';
  end if;

  select jsonb_build_object(
    'currency', coalesce((
      select btrim(currency) from public.company_settings
      where company_id = target_company_id
    ), 'ARS'),
    'concepts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', concept.id,
        'code', concept.code,
        'name', concept.name,
        'category', concept.category,
        'description', concept.description,
        'isSystem', concept.is_system,
        'isActive', concept.is_active
      ) order by concept.category, concept.name)
      from public.economic_concepts as concept
      where concept.company_id = target_company_id
    ), '[]'::jsonb),
    'rateCards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rate_card.id,
        'name', rate_card.name,
        'description', rate_card.description,
        'isActive', rate_card.is_active,
        'versions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', version.id,
            'versionNumber', version.version_number,
            'status', version.status,
            'currency', btrim(version.currency),
            'effectiveFrom', version.effective_from,
            'effectiveTo', version.effective_to,
            'notes', version.notes,
            'publishedAt', version.published_at,
            'rules', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', rule.id,
                'conceptId', rule.concept_id,
                'name', rule.name,
                'description', rule.description,
                'priority', rule.priority,
                'calculationType', rule.calculation_type,
                'fixedAmount', rule.fixed_amount,
                'percentage', rule.percentage,
                'formula', rule.formula,
                'minimumAmount', rule.minimum_amount,
                'maximumAmount', rule.maximum_amount,
                'taxBehavior', rule.tax_behavior,
                'taxRate', rule.tax_rate,
                'taxLabel', rule.tax_label,
                'conditions', rule.conditions,
                'isCumulative', rule.is_cumulative,
                'isActive', rule.is_active,
                'scopes', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'type', scope.scope_type,
                    'key', scope.scope_key
                  ) order by scope.scope_type, scope.scope_key)
                  from public.pricing_rule_scopes as scope
                  where scope.pricing_rule_id = rule.id
                ), '[]'::jsonb)
              ) order by rule.priority, rule.created_at)
              from public.pricing_rules as rule
              where rule.rate_card_version_id = version.id
            ), '[]'::jsonb)
          ) order by version.version_number desc)
          from public.rate_card_versions as version
          where version.rate_card_id = rate_card.id
        ), '[]'::jsonb)
      ) order by rate_card.name)
      from public.rate_cards as rate_card
      where rate_card.company_id = target_company_id
    ), '[]'::jsonb),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', client.id,
        'label', case
          when client.client_type = 'company' then coalesce(client.business_name, 'Empresa sin nombre')
          else coalesce(nullif(btrim(concat_ws(' ', client.first_name, client.last_name)), ''), 'Individuo sin nombre')
        end
      ) order by coalesce(client.business_name, client.first_name, client.last_name))
      from public.clients as client
      where client.company_id = target_company_id
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object('id', zone.id, 'label', zone.name) order by zone.name)
      from public.zones as zone where zone.company_id = target_company_id
    ), '[]'::jsonb),
    'destinations', coalesce((
      select jsonb_agg(jsonb_build_object('id', destination_place_id, 'label', destination_city) order by destination_city)
      from (
        select shipment.destination_place_id, min(shipment.destination_city) as destination_city
        from public.shipments as shipment
        where shipment.company_id = target_company_id
          and shipment.destination_place_id is not null
        group by shipment.destination_place_id
      ) as destination
    ), '[]'::jsonb)
  ) into result;

  return result;
end
$$;

create or replace function public.create_rate_card_draft(target_rate_card_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  source_version_id uuid;
  new_version_id uuid;
  next_version_number integer;
  source_currency char(3);
  source_rule record;
  new_rule_id uuid;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'pricing.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para crear borradores tarifarios.';
  end if;

  if exists (
    select 1 from public.rate_card_versions
    where rate_card_id = target_rate_card_id
      and company_id = target_company_id
      and status = 'draft'
  ) then
    raise exception using errcode = '23505', message = 'Esta lista ya tiene una versión borrador.';
  end if;

  select version.id, version.currency
  into source_version_id, source_currency
  from public.rate_card_versions as version
  where version.rate_card_id = target_rate_card_id
    and version.company_id = target_company_id
  order by version.version_number desc
  limit 1;

  if source_version_id is null then
    raise exception using errcode = '22023', message = 'La lista seleccionada no pertenece a esta empresa.';
  end if;

  select max(version_number) + 1 into next_version_number
  from public.rate_card_versions where rate_card_id = target_rate_card_id;

  insert into public.rate_card_versions (
    company_id, rate_card_id, version_number, currency, created_by
  ) values (
    target_company_id, target_rate_card_id, next_version_number, source_currency, auth.uid()
  ) returning id into new_version_id;

  for source_rule in
    select * from public.pricing_rules where rate_card_version_id = source_version_id
  loop
    insert into public.pricing_rules (
      company_id, rate_card_version_id, concept_id, name, description, priority,
      calculation_type, fixed_amount, percentage, formula, minimum_amount,
      maximum_amount, tax_behavior, tax_rate, tax_label, conditions,
      is_cumulative, is_active
    ) values (
      target_company_id, new_version_id, source_rule.concept_id, source_rule.name,
      source_rule.description, source_rule.priority, source_rule.calculation_type,
      source_rule.fixed_amount, source_rule.percentage, source_rule.formula,
      source_rule.minimum_amount, source_rule.maximum_amount,
      source_rule.tax_behavior, source_rule.tax_rate, source_rule.tax_label,
      source_rule.conditions, source_rule.is_cumulative, source_rule.is_active
    ) returning id into new_rule_id;

    insert into public.pricing_rule_scopes (company_id, pricing_rule_id, scope_type, scope_key)
    select target_company_id, new_rule_id, scope_type, scope_key
    from public.pricing_rule_scopes where pricing_rule_id = source_rule.id;
  end loop;

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_type, entity_id, new_data
  ) values (
    target_company_id, auth.uid(), 'pricing.draft_created', 'rate_card_version',
    new_version_id, jsonb_build_object('sourceVersionId', source_version_id)
  );

  return new_version_id;
end
$$;

revoke all on function public.save_pricing_rule(
  uuid, uuid, uuid, text, text, integer, text, numeric, numeric, jsonb,
  numeric, numeric, jsonb, boolean, boolean, jsonb
) from public, anon, authenticated;
drop function public.save_pricing_rule(
  uuid, uuid, uuid, text, text, integer, text, numeric, numeric, jsonb,
  numeric, numeric, jsonb, boolean, boolean, jsonb
);

create function public.save_pricing_rule(
  target_rule_id uuid,
  target_version_id uuid,
  target_concept_id uuid,
  requested_name text,
  requested_description text,
  requested_priority integer,
  requested_calculation_type text,
  requested_fixed_amount numeric,
  requested_percentage numeric,
  requested_formula jsonb,
  requested_minimum_amount numeric,
  requested_maximum_amount numeric,
  requested_tax_behavior text,
  requested_tax_rate numeric,
  requested_tax_label text,
  requested_conditions jsonb,
  requested_is_cumulative boolean,
  requested_is_active boolean,
  requested_scopes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  saved_rule public.pricing_rules%rowtype;
  previous_data jsonb;
  scope_data jsonb;
  scope_type text;
  scope_key text;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'pricing.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar reglas económicas.';
  end if;

  if jsonb_typeof(coalesce(requested_scopes, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Los alcances deben enviarse como una lista.';
  end if;

  requested_tax_behavior := coalesce(requested_tax_behavior, 'none');
  if requested_tax_behavior = 'none' then
    requested_tax_rate := null;
    requested_tax_label := null;
  end if;

  if target_rule_id is null then
    insert into public.pricing_rules (
      company_id, rate_card_version_id, concept_id, name, description, priority,
      calculation_type, fixed_amount, percentage, formula, minimum_amount,
      maximum_amount, tax_behavior, tax_rate, tax_label, conditions,
      is_cumulative, is_active
    ) values (
      target_company_id, target_version_id, target_concept_id, requested_name,
      requested_description, requested_priority, requested_calculation_type,
      requested_fixed_amount, requested_percentage, requested_formula,
      requested_minimum_amount, requested_maximum_amount, requested_tax_behavior,
      requested_tax_rate, requested_tax_label,
      coalesce(requested_conditions, '{}'::jsonb),
      coalesce(requested_is_cumulative, true), coalesce(requested_is_active, true)
    ) returning * into saved_rule;
  else
    select * into saved_rule
    from public.pricing_rules as rule
    where rule.id = target_rule_id and rule.company_id = target_company_id
    for update;

    if saved_rule.id is null or saved_rule.rate_card_version_id <> target_version_id then
      raise exception using errcode = '22023', message = 'La regla seleccionada no pertenece a este borrador.';
    end if;

    previous_data := to_jsonb(saved_rule);

    update public.pricing_rules
    set concept_id = target_concept_id,
        name = requested_name,
        description = requested_description,
        priority = requested_priority,
        calculation_type = requested_calculation_type,
        fixed_amount = requested_fixed_amount,
        percentage = requested_percentage,
        formula = requested_formula,
        minimum_amount = requested_minimum_amount,
        maximum_amount = requested_maximum_amount,
        tax_behavior = requested_tax_behavior,
        tax_rate = requested_tax_rate,
        tax_label = requested_tax_label,
        conditions = coalesce(requested_conditions, '{}'::jsonb),
        is_cumulative = coalesce(requested_is_cumulative, true),
        is_active = coalesce(requested_is_active, true),
        updated_at = now()
    where id = target_rule_id
    returning * into saved_rule;
  end if;

  delete from public.pricing_rule_scopes where pricing_rule_id = saved_rule.id;
  for scope_data in select value from jsonb_array_elements(coalesce(requested_scopes, '[]'::jsonb))
  loop
    scope_type := scope_data ->> 'type';
    scope_key := btrim(scope_data ->> 'key');

    if scope_type = 'client' and not exists (
      select 1 from public.clients where id::text = scope_key and company_id = target_company_id
    ) then
      raise exception using errcode = '22023', message = 'Un alcance de cliente no pertenece a esta empresa.';
    elsif scope_type = 'zone' and not exists (
      select 1 from public.zones where id::text = scope_key and company_id = target_company_id
    ) then
      raise exception using errcode = '22023', message = 'Un alcance de zona no pertenece a esta empresa.';
    elsif scope_type = 'destination' and not exists (
      select 1 from public.shipments
      where destination_place_id = scope_key and company_id = target_company_id
    ) then
      raise exception using errcode = '22023', message = 'Un alcance de destino no pertenece a esta empresa.';
    elsif scope_type not in ('client', 'zone', 'destination') then
      raise exception using errcode = '22023', message = 'El tipo de alcance económico es inválido.';
    end if;

    insert into public.pricing_rule_scopes (
      company_id, pricing_rule_id, scope_type, scope_key
    ) values (target_company_id, saved_rule.id, scope_type, scope_key);
  end loop;

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_type, entity_id, previous_data, new_data
  ) values (
    target_company_id, auth.uid(),
    case when target_rule_id is null then 'pricing.rule_created' else 'pricing.rule_updated' end,
    'pricing_rule', saved_rule.id, previous_data, to_jsonb(saved_rule)
  );

  return saved_rule.id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'La regla contiene un alcance duplicado.';
  when check_violation then
    raise exception using errcode = '22023', message = 'Revisa los datos, el impuesto y los límites de la regla.';
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
    'inputs', normalized_inputs - 'subtotal',
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
    raise exception using errcode = '22023', message = 'El cálculo contiene valores numéricos inválidos.';
end
$$;

create or replace function app_private.snapshot_shipment_charge_tax()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_behavior text;
  selected_rate numeric;
  selected_label text;
  absolute_amount numeric := abs(new.amount);
begin
  if new.pricing_rule_id is not null and not new.is_manual then
    select rule.tax_behavior, rule.tax_rate, rule.tax_label
    into selected_behavior, selected_rate, selected_label
    from public.pricing_rules as rule
    where rule.id = new.pricing_rule_id
      and rule.company_id = new.company_id;
  end if;

  new.tax_behavior := coalesce(selected_behavior, 'none');
  new.tax_rate := selected_rate;
  new.tax_label := selected_label;

  if new.tax_behavior in ('included', 'added') then
    new.tax_amount := round(absolute_amount * new.tax_rate / (100 + new.tax_rate), 2);
    new.net_amount := case
      when new.amount < 0 then -(absolute_amount - new.tax_amount)
      else absolute_amount - new.tax_amount
    end;
  else
    new.tax_amount := 0;
    new.net_amount := new.amount;
    new.tax_rate := null;
    new.tax_label := null;
  end if;

  return new;
end
$$;

drop trigger if exists snapshot_shipment_charge_tax on public.shipment_charges;
create trigger snapshot_shipment_charge_tax
before insert on public.shipment_charges
for each row execute function app_private.snapshot_shipment_charge_tax();

create or replace function app_private.refresh_current_shipment_tax_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_pricing_calculation_id is null
     or new.current_pricing_calculation_id is not distinct from old.current_pricing_calculation_id then
    return new;
  end if;

  update public.shipment_pricing_calculations as calculation
  set tax_total = totals.tax_total,
      included_tax_total = totals.included_tax_total,
      added_tax_total = totals.added_tax_total
  from (
    select
      coalesce(sum(charge.tax_amount), 0) as tax_total,
      coalesce(sum(charge.tax_amount) filter (where charge.tax_behavior = 'included'), 0) as included_tax_total,
      coalesce(sum(charge.tax_amount) filter (where charge.tax_behavior = 'added'), 0) as added_tax_total
    from public.shipment_charges as charge
    where charge.calculation_id = new.current_pricing_calculation_id
      and charge.shipment_id = new.id
      and charge.company_id = new.company_id
  ) as totals
  where calculation.id = new.current_pricing_calculation_id
    and calculation.shipment_id = new.id
    and calculation.company_id = new.company_id;

  return new;
end
$$;

-- PostgreSQL fires same-event triggers by name; the zz prefix makes this run
-- after carry_forward_shipment_adjustments from Phase 8.3.
drop trigger if exists zz_refresh_current_shipment_tax_totals on public.shipments;
create trigger zz_refresh_current_shipment_tax_totals
after update of current_pricing_calculation_id on public.shipments
for each row execute function app_private.refresh_current_shipment_tax_totals();

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
    'taxTotal', calculation.tax_total,
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

create or replace function public.get_shipment_pricing_history(
  target_shipment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  target_shipment public.shipments%rowtype;
  result jsonb;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'pricing.view') then
    raise exception using errcode = '42501', message = 'No tienes permiso para consultar el historial económico.';
  end if;

  select * into target_shipment
  from public.shipments
  where id = target_shipment_id and company_id = target_company_id;

  if target_shipment.id is null then
    raise exception using errcode = '22023', message = 'El movimiento no existe o no pertenece a esta empresa.';
  end if;

  select jsonb_build_object(
    'shipment', jsonb_build_object(
      'id', target_shipment.id,
      'trackingNumber', target_shipment.tracking_number,
      'currentCalculationId', target_shipment.current_pricing_calculation_id
    ),
    'concepts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', concept.id,
        'name', concept.name,
        'category', concept.category
      ) order by concept.category, concept.name)
      from public.economic_concepts as concept
      where concept.company_id = target_company_id and concept.is_active
    ), '[]'::jsonb),
    'calculations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', calculation.id,
        'sequence', calculation.calculation_sequence,
        'reason', calculation.calculation_reason,
        'rateCardName', calculation.rate_card_name_snapshot,
        'versionNumber', calculation.version_number_snapshot,
        'currency', btrim(calculation.currency),
        'inputs', calculation.inputs,
        'chargeTotal', calculation.charge_total,
        'discountTotal', calculation.discount_total,
        'customerTotal', calculation.customer_total,
        'internalCostTotal', calculation.internal_cost_total,
        'commissionTotal', calculation.commission_total,
        'taxTotal', calculation.tax_total,
        'includedTaxTotal', calculation.included_tax_total,
        'addedTaxTotal', calculation.added_tax_total,
        'calculatedAt', calculation.created_at,
        'calculatedByName', calculator.full_name,
        'isCurrent', calculation.id = target_shipment.current_pricing_calculation_id,
        'lineItems', coalesce((
          select jsonb_agg(jsonb_build_object(
            'lineNumber', charge.line_number,
            'conceptName', charge.concept_name_snapshot,
            'ruleName', charge.rule_name_snapshot,
            'category', charge.category,
            'calculationType', charge.calculation_type,
            'amount', charge.amount,
            'netAmount', charge.net_amount,
            'taxAmount', charge.tax_amount,
            'taxBehavior', charge.tax_behavior,
            'taxRate', charge.tax_rate,
            'taxLabel', charge.tax_label,
            'isManual', charge.is_manual,
            'adjustmentReason', charge.adjustment_reason,
            'createdByName', adjustment_actor.full_name
          ) order by charge.line_number)
          from public.shipment_charges as charge
          left join public.profiles as adjustment_actor
            on adjustment_actor.id = charge.created_by
          where charge.calculation_id = calculation.id
        ), '[]'::jsonb)
      ) order by calculation.calculation_sequence desc)
      from public.shipment_pricing_calculations as calculation
      left join public.profiles as calculator on calculator.id = calculation.calculated_by
      where calculation.shipment_id = target_shipment_id
        and calculation.company_id = target_company_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end
$$;

revoke all on function app_private.snapshot_shipment_charge_tax()
  from public, anon, authenticated;
revoke all on function app_private.refresh_current_shipment_tax_totals()
  from public, anon, authenticated;
revoke all on function public.get_pricing_workspace()
  from public, anon, authenticated;
revoke all on function public.create_rate_card_draft(uuid)
  from public, anon, authenticated;
revoke all on function public.save_pricing_rule(
  uuid, uuid, uuid, text, text, integer, text, numeric, numeric, jsonb,
  numeric, numeric, text, numeric, text, jsonb, boolean, boolean, jsonb
) from public, anon, authenticated;
revoke all on function public.simulate_pricing(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.get_current_shipment_pricing_summaries()
  from public, anon, authenticated;
revoke all on function public.get_shipment_pricing_history(uuid)
  from public, anon, authenticated;

grant execute on function public.get_pricing_workspace() to authenticated;
grant execute on function public.create_rate_card_draft(uuid) to authenticated;
grant execute on function public.save_pricing_rule(
  uuid, uuid, uuid, text, text, integer, text, numeric, numeric, jsonb,
  numeric, numeric, text, numeric, text, jsonb, boolean, boolean, jsonb
) to authenticated;
grant execute on function public.simulate_pricing(uuid, jsonb) to authenticated;
grant execute on function public.get_current_shipment_pricing_summaries()
  to authenticated;
grant execute on function public.get_shipment_pricing_history(uuid)
  to authenticated;

commit;

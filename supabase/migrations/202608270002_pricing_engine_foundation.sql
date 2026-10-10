-- Phase 8.1: versioned rate cards, safe pricing rules, tenant-scoped concepts,
-- and an explainable simulator. Shipment snapshots are intentionally deferred
-- until this editor/simulator contract is validated with live data.

begin;

-- Phase 7 created the landing-page preference before the pricing route existed.
alter table public.user_preferences
  drop constraint if exists user_preferences_landing_check;
alter table public.user_preferences
  add constraint user_preferences_landing_check
  check (default_landing_page in (
    'movements', 'statistics', 'clients', 'zones', 'team', 'roles', 'pricing', 'settings'
  ));

create table public.economic_concepts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code varchar(50) not null,
  name varchar(100) not null,
  category varchar(20) not null,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint economic_concepts_code_check
    check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint economic_concepts_name_check
    check (char_length(btrim(name)) between 2 and 100),
  constraint economic_concepts_category_check
    check (category in ('charge', 'discount', 'cost', 'commission'))
);

create unique index economic_concepts_company_code_key
  on public.economic_concepts (company_id, code);
create unique index economic_concepts_company_name_key
  on public.economic_concepts (company_id, lower(btrim(name)));

create table public.rate_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name varchar(100) not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_cards_name_check
    check (char_length(btrim(name)) between 2 and 100)
);

create unique index rate_cards_company_name_key
  on public.rate_cards (company_id, lower(btrim(name)));

create table public.rate_card_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rate_card_id uuid not null references public.rate_cards(id) on delete cascade,
  version_number integer not null,
  status varchar(20) not null default 'draft',
  currency char(3) not null,
  effective_from date,
  effective_to date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_card_versions_number_check check (version_number > 0),
  constraint rate_card_versions_status_check
    check (status in ('draft', 'published', 'retired')),
  constraint rate_card_versions_currency_check
    check (currency in ('ARS', 'USD', 'EUR', 'BRL')),
  constraint rate_card_versions_dates_check
    check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint rate_card_versions_publish_state_check
    check (
      (status = 'draft' and published_at is null and published_by is null)
      or (status in ('published', 'retired') and published_at is not null)
    )
);

create unique index rate_card_versions_number_key
  on public.rate_card_versions (rate_card_id, version_number);
create unique index rate_card_versions_one_draft_key
  on public.rate_card_versions (rate_card_id) where status = 'draft';
create index rate_card_versions_company_status_dates_idx
  on public.rate_card_versions (company_id, status, effective_from, effective_to);

create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rate_card_version_id uuid not null references public.rate_card_versions(id) on delete cascade,
  concept_id uuid not null references public.economic_concepts(id) on delete restrict,
  concept_name_snapshot varchar(100) not null,
  concept_category_snapshot varchar(20) not null,
  name varchar(120) not null,
  description text,
  priority integer not null default 100,
  calculation_type varchar(20) not null,
  fixed_amount numeric(18, 4),
  percentage numeric(10, 4),
  formula jsonb,
  minimum_amount numeric(18, 4),
  maximum_amount numeric(18, 4),
  conditions jsonb not null default '{}'::jsonb,
  is_cumulative boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_rules_name_check
    check (char_length(btrim(name)) between 2 and 120),
  constraint pricing_rules_concept_snapshot_check
    check (
      char_length(btrim(concept_name_snapshot)) between 2 and 100
      and concept_category_snapshot in ('charge', 'discount', 'cost', 'commission')
    ),
  constraint pricing_rules_priority_check check (priority between 1 and 10000),
  constraint pricing_rules_calculation_type_check
    check (calculation_type in ('fixed', 'percentage', 'formula')),
  constraint pricing_rules_calculation_value_check
    check (
      (calculation_type = 'fixed' and fixed_amount is not null and fixed_amount >= 0
        and percentage is null and formula is null)
      or (calculation_type = 'percentage' and percentage is not null
        and percentage between 0 and 1000 and fixed_amount is null and formula is null)
      or (calculation_type = 'formula' and formula is not null
        and fixed_amount is null and percentage is null)
    ),
  constraint pricing_rules_limits_check
    check (
      (minimum_amount is null or minimum_amount >= 0)
      and (maximum_amount is null or maximum_amount >= 0)
      and (minimum_amount is null or maximum_amount is null or maximum_amount >= minimum_amount)
    ),
  constraint pricing_rules_conditions_object_check
    check (jsonb_typeof(conditions) = 'object')
);

create index pricing_rules_version_priority_idx
  on public.pricing_rules (rate_card_version_id, priority, created_at);
create index pricing_rules_company_concept_idx
  on public.pricing_rules (company_id, concept_id);

create table public.pricing_rule_scopes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  pricing_rule_id uuid not null references public.pricing_rules(id) on delete cascade,
  scope_type varchar(20) not null,
  scope_key text not null,
  created_at timestamptz not null default now(),
  constraint pricing_rule_scopes_type_check
    check (scope_type in ('client', 'zone', 'destination')),
  constraint pricing_rule_scopes_key_check
    check (char_length(btrim(scope_key)) between 1 and 200)
);

create unique index pricing_rule_scopes_rule_type_key
  on public.pricing_rule_scopes (pricing_rule_id, scope_type, scope_key);
create index pricing_rule_scopes_company_lookup_idx
  on public.pricing_rule_scopes (company_id, scope_type, scope_key);

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
      'subtotal', 'package_count', 'weight_kg', 'volume_m3',
      'declared_value', 'distance_km'
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

create or replace function app_private.evaluate_pricing_expression(
  expression jsonb,
  pricing_inputs jsonb,
  expression_depth integer default 0
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  operator_name text := expression ->> 'op';
  left_value numeric;
  right_value numeric;
  variable_name text;
begin
  if not app_private.is_valid_pricing_expression(expression, expression_depth) then
    raise exception using errcode = '22023', message = 'Invalid pricing formula.';
  end if;

  if operator_name = 'constant' then
    return (expression ->> 'value')::numeric;
  end if;

  if operator_name = 'variable' then
    variable_name := expression ->> 'name';
    return coalesce((pricing_inputs ->> variable_name)::numeric, 0);
  end if;

  left_value := app_private.evaluate_pricing_expression(
    expression -> 'args' -> 0, pricing_inputs, expression_depth + 1
  );
  right_value := app_private.evaluate_pricing_expression(
    expression -> 'args' -> 1, pricing_inputs, expression_depth + 1
  );

  return case operator_name
    when 'add' then left_value + right_value
    when 'subtract' then left_value - right_value
    when 'multiply' then left_value * right_value
    when 'divide' then case
      when right_value = 0 then 0
      else left_value / right_value
    end
    when 'min' then least(left_value, right_value)
    when 'max' then greatest(left_value, right_value)
  end;
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

  if not exists (
    select 1 from public.rate_card_versions as version
    where version.id = new.rate_card_version_id
      and version.company_id = new.company_id
      and version.status = 'draft'
  ) then
    raise exception using errcode = '23514', message = 'Pricing rules may only change in a company draft version.';
  end if;

  select concept.name, concept.category
  into new.concept_name_snapshot, new.concept_category_snapshot
  from public.economic_concepts as concept
    where concept.id = new.concept_id
      and concept.company_id = new.company_id
      and concept.is_active;

  if new.concept_name_snapshot is null then
    raise exception using errcode = '23514', message = 'Select an active economic concept from this company.';
  end if;

  if new.calculation_type = 'formula'
     and not app_private.is_valid_pricing_expression(new.formula) then
    raise exception using errcode = '23514', message = 'The pricing formula contains unsupported operations or variables.';
  end if;

  if (new.conditions - array[
    'urgency', 'weekend', 'minimumPackageCount', 'minimumWeightKg',
    'minimumVolumeM3', 'minimumDeclaredValue', 'minimumDistanceKm'
  ]) <> '{}'::jsonb then
    raise exception using errcode = '23514', message = 'The pricing rule contains an unsupported condition.';
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
    raise exception using errcode = '23514', message = 'The pricing rule contains an invalid condition value.';
  end if;

  return new;
end
$$;

drop trigger if exists validate_pricing_rule on public.pricing_rules;
create trigger validate_pricing_rule
before insert or update on public.pricing_rules
for each row execute function app_private.validate_pricing_rule();

create or replace function app_private.seed_company_economic_concepts(target_company_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.economic_concepts (
    company_id, code, name, category, description, is_system
  ) values
    (target_company_id, 'base_delivery', 'Precio base de entrega', 'charge', 'Importe inicial del servicio.', true),
    (target_company_id, 'zone_surcharge', 'Recargo por zona', 'charge', 'Adicional por cobertura o distancia de zona.', true),
    (target_company_id, 'client_discount', 'Descuento de cliente', 'discount', 'Bonificación comercial por cliente.', true),
    (target_company_id, 'insurance', 'Seguro', 'charge', 'Cargo relacionado con el valor declarado.', true),
    (target_company_id, 'handling', 'Manipulación', 'charge', 'Preparación o manipulación especial.', true),
    (target_company_id, 'urgency', 'Urgencia', 'charge', 'Recargo por servicio urgente.', true),
    (target_company_id, 'weight_volume', 'Peso o volumen', 'charge', 'Importe calculado por peso o volumen.', true),
    (target_company_id, 'failed_delivery', 'Entrega fallida', 'cost', 'Costo interno de un intento fallido.', true),
    (target_company_id, 'fuel_adjustment', 'Ajuste de combustible', 'charge', 'Ajuste porcentual por combustible.', true),
    (target_company_id, 'employee_commission', 'Comisión operativa', 'commission', 'Comisión interna para conductor o empleado.', true)
  on conflict (company_id, code) do nothing;
$$;

select app_private.seed_company_economic_concepts(company.id)
from public.companies as company;

create or replace function app_private.create_company_economic_concepts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.seed_company_economic_concepts(new.id);
  return new;
end
$$;

drop trigger if exists create_company_economic_concepts on public.companies;
create trigger create_company_economic_concepts
after insert on public.companies
for each row execute function app_private.create_company_economic_concepts();

revoke all on function app_private.is_valid_pricing_expression(jsonb, integer) from public, anon, authenticated;
revoke all on function app_private.evaluate_pricing_expression(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function app_private.validate_pricing_rule() from public, anon, authenticated;
revoke all on function app_private.seed_company_economic_concepts(uuid) from public, anon, authenticated;
revoke all on function app_private.create_company_economic_concepts() from public, anon, authenticated;

alter table public.economic_concepts enable row level security;
alter table public.economic_concepts force row level security;
alter table public.rate_cards enable row level security;
alter table public.rate_cards force row level security;
alter table public.rate_card_versions enable row level security;
alter table public.rate_card_versions force row level security;
alter table public.pricing_rules enable row level security;
alter table public.pricing_rules force row level security;
alter table public.pricing_rule_scopes enable row level security;
alter table public.pricing_rule_scopes force row level security;

create policy economic_concepts_select_permitted on public.economic_concepts
for select to authenticated using (app_private.has_permission(company_id, 'pricing.view'));
create policy rate_cards_select_permitted on public.rate_cards
for select to authenticated using (app_private.has_permission(company_id, 'pricing.view'));
create policy rate_card_versions_select_permitted on public.rate_card_versions
for select to authenticated using (app_private.has_permission(company_id, 'pricing.view'));
create policy pricing_rules_select_permitted on public.pricing_rules
for select to authenticated using (app_private.has_permission(company_id, 'pricing.view'));
create policy pricing_rule_scopes_select_permitted on public.pricing_rule_scopes
for select to authenticated using (app_private.has_permission(company_id, 'pricing.view'));

revoke all on table public.economic_concepts from anon, authenticated;
revoke all on table public.rate_cards from anon, authenticated;
revoke all on table public.rate_card_versions from anon, authenticated;
revoke all on table public.pricing_rules from anon, authenticated;
revoke all on table public.pricing_rule_scopes from anon, authenticated;
grant select on table public.economic_concepts to authenticated;
grant select on table public.rate_cards to authenticated;
grant select on table public.rate_card_versions to authenticated;
grant select on table public.pricing_rules to authenticated;
grant select on table public.pricing_rule_scopes to authenticated;

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
    raise exception using errcode = '42501', message = 'You do not have permission to view economic values.';
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

create or replace function public.save_economic_concept(
  target_concept_id uuid,
  requested_name text,
  requested_code text,
  requested_category text,
  requested_description text,
  requested_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  saved_concept public.economic_concepts%rowtype;
  previous_data jsonb;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'pricing.manage') then
    raise exception using errcode = '42501', message = 'You do not have permission to manage economic concepts.';
  end if;

  requested_name := btrim(requested_name);
  requested_code := lower(btrim(requested_code));
  requested_description := nullif(btrim(requested_description), '');

  if target_concept_id is null then
    insert into public.economic_concepts (
      company_id, code, name, category, description, is_active
    ) values (
      target_company_id, requested_code, requested_name, requested_category,
      requested_description, coalesce(requested_is_active, true)
    ) returning * into saved_concept;
  else
    select * into saved_concept
    from public.economic_concepts as concept
    where concept.id = target_concept_id and concept.company_id = target_company_id
    for update;

    if saved_concept.id is null then
      raise exception using errcode = '22023', message = 'The selected concept does not belong to this company.';
    end if;
    if saved_concept.is_system and (
      requested_code is distinct from saved_concept.code
      or requested_category is distinct from saved_concept.category
    ) then
      raise exception using errcode = '42501', message = 'System concept code and category cannot change.';
    end if;

    previous_data := to_jsonb(saved_concept);

    update public.economic_concepts
    set code = requested_code,
        name = requested_name,
        category = requested_category,
        description = requested_description,
        is_active = coalesce(requested_is_active, true),
        updated_at = now()
    where id = target_concept_id
    returning * into saved_concept;
  end if;

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_type, entity_id, previous_data, new_data
  ) values (
    target_company_id, auth.uid(),
    case when target_concept_id is null then 'pricing.concept_created' else 'pricing.concept_updated' end,
    'economic_concept', saved_concept.id, previous_data, to_jsonb(saved_concept)
  );

  return saved_concept.id;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'A concept with this code or name already exists.';
end
$$;

create or replace function public.save_rate_card(
  target_rate_card_id uuid,
  requested_name text,
  requested_description text,
  requested_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  company_currency char(3);
  saved_card public.rate_cards%rowtype;
  previous_data jsonb;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'pricing.manage') then
    raise exception using errcode = '42501', message = 'You do not have permission to manage rate cards.';
  end if;

  requested_name := btrim(requested_name);
  requested_description := nullif(btrim(requested_description), '');

  if target_rate_card_id is null then
    insert into public.rate_cards (company_id, name, description, is_active)
    values (target_company_id, requested_name, requested_description, coalesce(requested_is_active, true))
    returning * into saved_card;

    select currency into company_currency from public.company_settings
    where company_id = target_company_id;

    insert into public.rate_card_versions (
      company_id, rate_card_id, version_number, currency, created_by
    ) values (
      target_company_id, saved_card.id, 1, coalesce(company_currency, 'ARS'), auth.uid()
    );
  else
    select * into saved_card
    from public.rate_cards as rate_card
    where rate_card.id = target_rate_card_id and rate_card.company_id = target_company_id
    for update;

    if saved_card.id is null then
      raise exception using errcode = '22023', message = 'The selected rate card does not belong to this company.';
    end if;

    previous_data := to_jsonb(saved_card);

    update public.rate_cards
    set name = requested_name,
        description = requested_description,
        is_active = coalesce(requested_is_active, true),
        updated_at = now()
    where id = target_rate_card_id
    returning * into saved_card;
  end if;

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_type, entity_id, previous_data, new_data
  ) values (
    target_company_id, auth.uid(),
    case when target_rate_card_id is null then 'pricing.rate_card_created' else 'pricing.rate_card_updated' end,
    'rate_card', saved_card.id, previous_data, to_jsonb(saved_card)
  );

  return saved_card.id;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'A rate card with this name already exists.';
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
    raise exception using errcode = '42501', message = 'You do not have permission to create rate card drafts.';
  end if;

  if exists (
    select 1 from public.rate_card_versions
    where rate_card_id = target_rate_card_id
      and company_id = target_company_id
      and status = 'draft'
  ) then
    raise exception using errcode = '23505', message = 'This rate card already has a draft.';
  end if;

  select version.id, version.currency
  into source_version_id, source_currency
  from public.rate_card_versions as version
  where version.rate_card_id = target_rate_card_id
    and version.company_id = target_company_id
  order by version.version_number desc
  limit 1;

  if source_version_id is null then
    raise exception using errcode = '22023', message = 'The selected rate card does not belong to this company.';
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
      maximum_amount, conditions, is_cumulative, is_active
    ) values (
      target_company_id, new_version_id, source_rule.concept_id, source_rule.name,
      source_rule.description, source_rule.priority, source_rule.calculation_type,
      source_rule.fixed_amount, source_rule.percentage, source_rule.formula,
      source_rule.minimum_amount, source_rule.maximum_amount, source_rule.conditions,
      source_rule.is_cumulative, source_rule.is_active
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

create or replace function public.save_pricing_rule(
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
    raise exception using errcode = '42501', message = 'You do not have permission to manage pricing rules.';
  end if;

  if jsonb_typeof(coalesce(requested_scopes, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Pricing scopes must be an array.';
  end if;

  if target_rule_id is null then
    insert into public.pricing_rules (
      company_id, rate_card_version_id, concept_id, name, description, priority,
      calculation_type, fixed_amount, percentage, formula, minimum_amount,
      maximum_amount, conditions, is_cumulative, is_active
    ) values (
      target_company_id, target_version_id, target_concept_id, requested_name,
      requested_description, requested_priority, requested_calculation_type,
      requested_fixed_amount, requested_percentage, requested_formula,
      requested_minimum_amount, requested_maximum_amount,
      coalesce(requested_conditions, '{}'::jsonb),
      coalesce(requested_is_cumulative, true), coalesce(requested_is_active, true)
    ) returning * into saved_rule;
  else
    select * into saved_rule
    from public.pricing_rules as rule
    where rule.id = target_rule_id and rule.company_id = target_company_id
    for update;

    if saved_rule.id is null or saved_rule.rate_card_version_id <> target_version_id then
      raise exception using errcode = '22023', message = 'The selected pricing rule does not belong to this draft.';
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
      raise exception using errcode = '22023', message = 'A client scope does not belong to this company.';
    elsif scope_type = 'zone' and not exists (
      select 1 from public.zones where id::text = scope_key and company_id = target_company_id
    ) then
      raise exception using errcode = '22023', message = 'A zone scope does not belong to this company.';
    elsif scope_type = 'destination' and not exists (
      select 1 from public.shipments
      where destination_place_id = scope_key and company_id = target_company_id
    ) then
      raise exception using errcode = '22023', message = 'A destination scope does not belong to this company.';
    elsif scope_type not in ('client', 'zone', 'destination') then
      raise exception using errcode = '22023', message = 'Invalid pricing scope type.';
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
exception when unique_violation then
  raise exception using errcode = '23505', message = 'This pricing rule contains a duplicate scope.';
end
$$;

create or replace function public.publish_rate_card_version(
  target_version_id uuid,
  requested_effective_from date,
  requested_effective_to date,
  requested_currency text,
  requested_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  target_version public.rate_card_versions%rowtype;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'pricing.manage') then
    raise exception using errcode = '42501', message = 'You do not have permission to publish rate cards.';
  end if;

  select * into target_version from public.rate_card_versions
  where id = target_version_id and company_id = target_company_id
  for update;

  if target_version.id is null or target_version.status <> 'draft' then
    raise exception using errcode = '22023', message = 'Only a company draft version can be published.';
  end if;
  if requested_effective_from is null
     or (requested_effective_to is not null and requested_effective_to < requested_effective_from) then
    raise exception using errcode = '22023', message = 'Select a valid effective date range.';
  end if;
  if not exists (
    select 1 from public.pricing_rules
    where rate_card_version_id = target_version_id and is_active
  ) then
    raise exception using errcode = '22023', message = 'Add at least one active pricing rule before publishing.';
  end if;
  if exists (
    select 1 from public.rate_card_versions as published
    where published.rate_card_id = target_version.rate_card_id
      and published.status = 'published'
      and daterange(
        published.effective_from,
        coalesce(published.effective_to, 'infinity'::date), '[]'
      ) && daterange(
        requested_effective_from,
        coalesce(requested_effective_to, 'infinity'::date), '[]'
      )
  ) then
    raise exception using errcode = '22023', message = 'This effective range overlaps another published version.';
  end if;

  update public.rate_card_versions
  set status = 'published',
      currency = upper(btrim(requested_currency)),
      effective_from = requested_effective_from,
      effective_to = requested_effective_to,
      notes = nullif(btrim(requested_notes), ''),
      published_by = auth.uid(),
      published_at = now(),
      updated_at = now()
  where id = target_version_id;

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_type, entity_id, new_data
  ) values (
    target_company_id, auth.uid(), 'pricing.version_published',
    'rate_card_version', target_version_id,
    jsonb_build_object(
      'effectiveFrom', requested_effective_from,
      'effectiveTo', requested_effective_to,
      'currency', upper(btrim(requested_currency))
    )
  );

  return target_version_id;
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
  signed_amount numeric;
  customer_subtotal numeric := 0;
  charge_total numeric := 0;
  discount_total numeric := 0;
  internal_cost_total numeric := 0;
  commission_total numeric := 0;
  line_items jsonb := '[]'::jsonb;
  applies boolean;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'pricing.view') then
    raise exception using errcode = '42501', message = 'You do not have permission to simulate economic values.';
  end if;

  select * into selected_version from public.rate_card_versions
  where id = target_version_id and company_id = target_company_id;

  if selected_version.id is null
     or (
       selected_version.status = 'draft'
       and not app_private.has_permission(target_company_id, 'pricing.manage')
     ) then
    raise exception using errcode = '42501', message = 'This rate card version is not available for simulation.';
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
    raise exception using errcode = '22023', message = 'One or more simulator inputs exceed the allowed range.';
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
      raise exception using errcode = '22003', message = 'A pricing rule exceeds the maximum supported amount.';
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

    if not rule_data.is_cumulative then
      exit;
    end if;
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
  raise exception using errcode = '22023', message = 'The simulator contains invalid numeric inputs.';
end
$$;

revoke all on function public.get_pricing_workspace() from public, anon, authenticated;
revoke all on function public.save_economic_concept(uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.save_rate_card(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.create_rate_card_draft(uuid) from public, anon, authenticated;
revoke all on function public.save_pricing_rule(
  uuid, uuid, uuid, text, text, integer, text, numeric, numeric, jsonb,
  numeric, numeric, jsonb, boolean, boolean, jsonb
) from public, anon, authenticated;
revoke all on function public.publish_rate_card_version(uuid, date, date, text, text) from public, anon, authenticated;
revoke all on function public.simulate_pricing(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.get_pricing_workspace() to authenticated;
grant execute on function public.save_economic_concept(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.save_rate_card(uuid, text, text, boolean) to authenticated;
grant execute on function public.create_rate_card_draft(uuid) to authenticated;
grant execute on function public.save_pricing_rule(
  uuid, uuid, uuid, text, text, integer, text, numeric, numeric, jsonb,
  numeric, numeric, jsonb, boolean, boolean, jsonb
) to authenticated;
grant execute on function public.publish_rate_card_version(uuid, date, date, text, text) to authenticated;
grant execute on function public.simulate_pricing(uuid, jsonb) to authenticated;

commit;

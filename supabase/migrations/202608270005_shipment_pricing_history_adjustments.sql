-- Phase 8.3: explainable movement pricing history and append-only manual
-- adjustments. Adjustments create a new current calculation while preserving
-- every prior calculation and line item unchanged.

begin;

-- Wait for active requests before taking any DDL lock. Acquiring the affected
-- relations up front in shipment -> calculation -> lines order prevents the
-- cycle in which PostgREST holds a shipment read lock while waiting for a
-- pricing table that this migration already altered, and the migration later
-- waits for the shipment table to create its trigger.
set local lock_timeout = '30s';
lock table public.shipments in access exclusive mode;
lock table public.shipment_pricing_calculations in access exclusive mode;
lock table public.shipment_charges in access exclusive mode;

alter table public.shipment_pricing_calculations
  drop constraint shipment_pricing_calculations_reason_check;
alter table public.shipment_pricing_calculations
  add constraint shipment_pricing_calculations_reason_check
  check (calculation_reason in (
    'creation', 'movement_update', 'manual_recalculation', 'manual_adjustment'
  ));

alter table public.shipment_charges
  drop constraint shipment_charges_calculation_type_check;
alter table public.shipment_charges
  add column is_manual boolean not null default false,
  add column adjustment_reason text,
  -- Keep the immutable actor identifier even if its profile is later removed.
  -- Avoiding a profile FK also keeps this DDL transaction out of the profile /
  -- shipment lock order used by authenticated requests.
  add column created_by uuid;
alter table public.shipment_charges
  add constraint shipment_charges_calculation_type_check
  check (calculation_type in ('fixed', 'percentage', 'formula', 'manual'));
alter table public.shipment_charges
  add constraint shipment_charges_manual_reason_check
  check (
    (not is_manual and calculation_type <> 'manual' and adjustment_reason is null)
    or (
      is_manual and calculation_type = 'manual'
      and char_length(btrim(adjustment_reason)) between 5 and 500
    )
  );

create or replace function app_private.carry_forward_shipment_adjustments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_calculation_reason text;
  base_line_number integer;
  carried_count integer;
  carried_charge numeric;
  carried_discount numeric;
  carried_cost numeric;
  carried_commission numeric;
begin
  if new.current_pricing_calculation_id is null
     or old.current_pricing_calculation_id is null
     or new.current_pricing_calculation_id is not distinct from old.current_pricing_calculation_id then
    return new;
  end if;

  select calculation_reason
  into new_calculation_reason
  from public.shipment_pricing_calculations
  where id = new.current_pricing_calculation_id
    and shipment_id = new.id
    and company_id = new.company_id;

  if new_calculation_reason <> 'movement_update' then
    return new;
  end if;

  select
    count(*),
    coalesce(sum(abs(amount)) filter (where category = 'charge'), 0),
    coalesce(sum(abs(amount)) filter (where category = 'discount'), 0),
    coalesce(sum(abs(amount)) filter (where category = 'cost'), 0),
    coalesce(sum(abs(amount)) filter (where category = 'commission'), 0)
  into carried_count, carried_charge, carried_discount, carried_cost, carried_commission
  from public.shipment_charges
  where calculation_id = old.current_pricing_calculation_id
    and is_manual;

  if carried_count = 0 then
    return new;
  end if;

  select coalesce(max(line_number), 0)
  into base_line_number
  from public.shipment_charges
  where calculation_id = new.current_pricing_calculation_id;

  insert into public.shipment_charges (
    company_id, shipment_id, calculation_id, line_number,
    pricing_rule_id, concept_id, concept_name_snapshot, rule_name_snapshot,
    category, calculation_type, amount, is_manual, adjustment_reason, created_by
  )
  select
    charge.company_id,
    charge.shipment_id,
    new.current_pricing_calculation_id,
    base_line_number + (row_number() over (order by charge.line_number))::integer,
    charge.pricing_rule_id,
    charge.concept_id,
    charge.concept_name_snapshot,
    charge.rule_name_snapshot,
    charge.category,
    charge.calculation_type,
    charge.amount,
    true,
    charge.adjustment_reason,
    charge.created_by
  from public.shipment_charges as charge
  where charge.calculation_id = old.current_pricing_calculation_id
    and charge.is_manual
  order by charge.line_number;

  update public.shipment_pricing_calculations
  set charge_total = charge_total + carried_charge,
      discount_total = discount_total + carried_discount,
      customer_total = greatest(
        (charge_total + carried_charge) - (discount_total + carried_discount),
        0
      ),
      internal_cost_total = internal_cost_total + carried_cost,
      commission_total = commission_total + carried_commission
  where id = new.current_pricing_calculation_id;

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_type, entity_id, new_data
  ) values (
    new.company_id,
    auth.uid(),
    'shipment.pricing_adjustments_carried',
    'shipment',
    new.id,
    jsonb_build_object(
      'fromCalculationId', old.current_pricing_calculation_id,
      'toCalculationId', new.current_pricing_calculation_id,
      'adjustmentCount', carried_count
    )
  );

  return new;
end
$$;

drop trigger if exists carry_forward_shipment_adjustments on public.shipments;
create trigger carry_forward_shipment_adjustments
after update of current_pricing_calculation_id on public.shipments
for each row execute function app_private.carry_forward_shipment_adjustments();

revoke all on function app_private.carry_forward_shipment_adjustments()
  from public, anon, authenticated;

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

create or replace function public.apply_shipment_pricing_adjustment(
  target_shipment_id uuid,
  target_concept_id uuid,
  requested_amount numeric,
  requested_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  target_shipment public.shipments%rowtype;
  current_calculation public.shipment_pricing_calculations%rowtype;
  selected_concept public.economic_concepts%rowtype;
  new_calculation_id uuid;
  next_sequence integer;
  next_line_number integer;
  new_charge_total numeric;
  new_discount_total numeric;
  new_internal_cost_total numeric;
  new_commission_total numeric;
  new_customer_total numeric;
  signed_amount numeric;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'pricing.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para aplicar ajustes económicos.';
  end if;

  requested_reason := btrim(requested_reason);
  if requested_amount is null or requested_amount <= 0
     or requested_amount > 1000000000000 then
    raise exception using errcode = '22023', message = 'Ingresa un importe de ajuste válido y mayor que cero.';
  end if;
  if requested_reason is null or char_length(requested_reason) not between 5 and 500 then
    raise exception using errcode = '22023', message = 'El motivo debe contener entre 5 y 500 caracteres.';
  end if;

  select * into target_shipment
  from public.shipments
  where id = target_shipment_id and company_id = target_company_id
  for update;

  if target_shipment.id is null then
    raise exception using errcode = '22023', message = 'El movimiento no existe o no pertenece a esta empresa.';
  end if;
  if target_shipment.current_pricing_calculation_id is null then
    raise exception using errcode = '22023', message = 'El movimiento debe estar valorizado antes de recibir ajustes.';
  end if;

  select * into current_calculation
  from public.shipment_pricing_calculations
  where id = target_shipment.current_pricing_calculation_id
    and shipment_id = target_shipment.id
    and company_id = target_company_id;

  if current_calculation.id is null then
    raise exception using errcode = 'P0001', message = 'No pudimos encontrar el cálculo económico vigente.';
  end if;

  select * into selected_concept
  from public.economic_concepts
  where id = target_concept_id
    and company_id = target_company_id
    and is_active;

  if selected_concept.id is null then
    raise exception using errcode = '22023', message = 'Selecciona un concepto económico activo de esta empresa.';
  end if;

  new_charge_total := current_calculation.charge_total
    + case when selected_concept.category = 'charge' then requested_amount else 0 end;
  new_discount_total := current_calculation.discount_total
    + case when selected_concept.category = 'discount' then requested_amount else 0 end;
  new_internal_cost_total := current_calculation.internal_cost_total
    + case when selected_concept.category = 'cost' then requested_amount else 0 end;
  new_commission_total := current_calculation.commission_total
    + case when selected_concept.category = 'commission' then requested_amount else 0 end;
  new_customer_total := greatest(new_charge_total - new_discount_total, 0);
  signed_amount := case
    when selected_concept.category = 'discount' then -requested_amount
    else requested_amount
  end;

  select coalesce(max(calculation_sequence), 0) + 1
  into next_sequence
  from public.shipment_pricing_calculations
  where shipment_id = target_shipment.id;

  insert into public.shipment_pricing_calculations (
    company_id, shipment_id, calculation_sequence, calculation_reason,
    rate_card_id, rate_card_version_id, rate_card_name_snapshot,
    version_number_snapshot, currency, inputs, charge_total, discount_total,
    customer_total, internal_cost_total, commission_total, calculated_by
  ) values (
    target_company_id,
    target_shipment.id,
    next_sequence,
    'manual_adjustment',
    current_calculation.rate_card_id,
    current_calculation.rate_card_version_id,
    current_calculation.rate_card_name_snapshot,
    current_calculation.version_number_snapshot,
    current_calculation.currency,
    current_calculation.inputs,
    new_charge_total,
    new_discount_total,
    new_customer_total,
    new_internal_cost_total,
    new_commission_total,
    auth.uid()
  ) returning id into new_calculation_id;

  insert into public.shipment_charges (
    company_id, shipment_id, calculation_id, line_number,
    pricing_rule_id, concept_id, concept_name_snapshot, rule_name_snapshot,
    category, calculation_type, amount, is_manual, adjustment_reason, created_by
  )
  select
    company_id,
    shipment_id,
    new_calculation_id,
    line_number,
    pricing_rule_id,
    concept_id,
    concept_name_snapshot,
    rule_name_snapshot,
    category,
    calculation_type,
    amount,
    is_manual,
    adjustment_reason,
    created_by
  from public.shipment_charges
  where calculation_id = current_calculation.id
  order by line_number;

  select coalesce(max(line_number), 0) + 1
  into next_line_number
  from public.shipment_charges
  where calculation_id = new_calculation_id;

  insert into public.shipment_charges (
    company_id, shipment_id, calculation_id, line_number,
    concept_id, concept_name_snapshot, rule_name_snapshot,
    category, calculation_type, amount, is_manual, adjustment_reason, created_by
  ) values (
    target_company_id,
    target_shipment.id,
    new_calculation_id,
    next_line_number,
    selected_concept.id,
    selected_concept.name,
    'Ajuste manual',
    selected_concept.category,
    'manual',
    signed_amount,
    true,
    requested_reason,
    auth.uid()
  );

  update public.shipments
  set current_pricing_calculation_id = new_calculation_id
  where id = target_shipment.id;

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_type, entity_id,
    previous_data, new_data
  ) values (
    target_company_id,
    auth.uid(),
    'shipment.pricing_adjusted',
    'shipment',
    target_shipment.id,
    jsonb_build_object(
      'calculationId', current_calculation.id,
      'customerTotal', current_calculation.customer_total
    ),
    jsonb_build_object(
      'calculationId', new_calculation_id,
      'customerTotal', new_customer_total,
      'conceptId', selected_concept.id,
      'category', selected_concept.category,
      'amount', signed_amount,
      'reason', requested_reason
    )
  );

  return new_calculation_id;
end
$$;

revoke all on function public.get_shipment_pricing_history(uuid)
  from public, anon, authenticated;
revoke all on function public.apply_shipment_pricing_adjustment(
  uuid, uuid, numeric, text
) from public, anon, authenticated;
grant execute on function public.get_shipment_pricing_history(uuid)
  to authenticated;
grant execute on function public.apply_shipment_pricing_adjustment(
  uuid, uuid, numeric, text
) to authenticated;

commit;

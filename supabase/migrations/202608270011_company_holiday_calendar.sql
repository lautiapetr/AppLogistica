-- Phase 10.1: tenant-owned company holiday calendar foundation. Holidays are
-- managed and audited here; pricing-rule evaluation is connected in the next
-- increment so simulator and final movement calculation can change together.

begin;

create table public.company_holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  holiday_date date not null,
  name varchar(120) not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_holidays_date_check
    check (holiday_date between date '2000-01-01' and date '2100-12-31'),
  constraint company_holidays_name_check
    check (char_length(btrim(name)) between 2 and 120)
);

create unique index company_holidays_company_date_key
  on public.company_holidays (company_id, holiday_date);
create index company_holidays_company_active_date_idx
  on public.company_holidays (company_id, is_active, holiday_date);

alter table public.company_holidays enable row level security;
alter table public.company_holidays force row level security;

create policy company_holidays_select_permitted
on public.company_holidays for select to authenticated
using (app_private.has_permission(company_id, 'pricing.view'));

revoke all on table public.company_holidays from anon, authenticated;
grant select on table public.company_holidays to authenticated;

create or replace function public.get_company_holidays(requested_year integer)
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
    raise exception using errcode = '42501', message = 'No tienes permiso para consultar el calendario tarifario.';
  end if;

  if requested_year is null or requested_year not between 2000 and 2100 then
    raise exception using errcode = '22023', message = 'Selecciona un año válido entre 2000 y 2100.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', holiday.id,
    'date', holiday.holiday_date,
    'name', holiday.name,
    'isActive', holiday.is_active
  ) order by holiday.holiday_date), '[]'::jsonb)
  into result
  from public.company_holidays as holiday
  where holiday.company_id = target_company_id
    and extract(year from holiday.holiday_date)::integer = requested_year;

  return result;
end
$$;

create or replace function public.save_company_holiday(
  target_holiday_id uuid,
  requested_date date,
  requested_name text,
  requested_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  saved_holiday public.company_holidays%rowtype;
  previous_data jsonb;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'pricing.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar el calendario tarifario.';
  end if;

  requested_name := btrim(requested_name);

  if target_holiday_id is null then
    insert into public.company_holidays (
      company_id, holiday_date, name, is_active, created_by, updated_by
    ) values (
      target_company_id, requested_date, requested_name,
      coalesce(requested_is_active, true), auth.uid(), auth.uid()
    ) returning * into saved_holiday;
  else
    select * into saved_holiday
    from public.company_holidays as holiday
    where holiday.id = target_holiday_id
      and holiday.company_id = target_company_id
    for update;

    if saved_holiday.id is null then
      raise exception using errcode = '22023', message = 'El feriado no existe o no pertenece a esta empresa.';
    end if;

    previous_data := to_jsonb(saved_holiday);

    update public.company_holidays
    set holiday_date = requested_date,
        name = requested_name,
        is_active = coalesce(requested_is_active, true),
        updated_by = auth.uid(),
        updated_at = now()
    where id = target_holiday_id
    returning * into saved_holiday;
  end if;

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_type, entity_id,
    previous_data, new_data
  ) values (
    target_company_id,
    auth.uid(),
    case
      when target_holiday_id is null then 'pricing.holiday_created'
      else 'pricing.holiday_updated'
    end,
    'company_holiday',
    saved_holiday.id,
    previous_data,
    to_jsonb(saved_holiday)
  );

  return saved_holiday.id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Ya existe un feriado configurado para esa fecha.';
  when check_violation then
    raise exception using errcode = '22023', message = 'Revisa la fecha y el nombre del feriado.';
end
$$;

revoke all on function public.get_company_holidays(integer)
  from public, anon, authenticated;
revoke all on function public.save_company_holiday(uuid, date, text, boolean)
  from public, anon, authenticated;
grant execute on function public.get_company_holidays(integer) to authenticated;
grant execute on function public.save_company_holiday(uuid, date, text, boolean)
  to authenticated;

commit;

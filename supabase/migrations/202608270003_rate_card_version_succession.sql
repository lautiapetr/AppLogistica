-- Phase 8.1 follow-up: publishing a successor version closes the preceding
-- validity range automatically. This keeps published history immutable while
-- making the normal v1 -> v2 workflow possible from the pricing editor.

begin;

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
  preceding_version public.rate_card_versions%rowtype;
  preceding_version_change text;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'pricing.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para publicar listas tarifarias.';
  end if;

  select *
  into target_version
  from public.rate_card_versions
  where id = target_version_id
    and company_id = target_company_id
  for update;

  if target_version.id is null or target_version.status <> 'draft' then
    raise exception using errcode = '22023', message = 'Sólo puede publicarse una versión borrador de esta empresa.';
  end if;

  if requested_effective_from is null
     or (requested_effective_to is not null and requested_effective_to < requested_effective_from) then
    raise exception using errcode = '22023', message = 'Selecciona un período de vigencia válido.';
  end if;

  requested_currency := upper(btrim(requested_currency));
  if requested_currency not in ('ARS', 'USD', 'EUR', 'BRL') then
    raise exception using errcode = '22023', message = 'Selecciona una moneda válida.';
  end if;

  if not exists (
    select 1
    from public.pricing_rules
    where rate_card_version_id = target_version_id
      and is_active
  ) then
    raise exception using errcode = '22023', message = 'Agrega al menos una regla activa antes de publicar.';
  end if;

  -- Serialize publication within this rate card. The lock prevents two drafts
  -- from passing the overlap check concurrently.
  perform 1
  from public.rate_card_versions as version
  where version.rate_card_id = target_version.rate_card_id
    and version.company_id = target_company_id
  for update;

  -- A published version that contains the new start date is the natural
  -- predecessor. Close it on the previous day, or retire it when both versions
  -- begin on the same day (common while configuring a new rate card).
  select version.*
  into preceding_version
  from public.rate_card_versions as version
  where version.rate_card_id = target_version.rate_card_id
    and version.company_id = target_company_id
    and version.id <> target_version_id
    and version.status = 'published'
    and version.effective_from <= requested_effective_from
    and coalesce(version.effective_to, 'infinity'::date) >= requested_effective_from
  order by version.effective_from desc, version.version_number desc
  limit 1;

  if preceding_version.id is not null then
    if preceding_version.version_number >= target_version.version_number then
      raise exception using
        errcode = '22023',
        message = 'La nueva vigencia sólo puede reemplazar una versión anterior de la lista.';
    end if;

    if preceding_version.effective_from = requested_effective_from then
      update public.rate_card_versions
      set status = 'retired',
          updated_at = now()
      where id = preceding_version.id;
      preceding_version_change := 'retired';
    else
      update public.rate_card_versions
      set effective_to = requested_effective_from - 1,
          updated_at = now()
      where id = preceding_version.id;
      preceding_version_change := 'closed';
    end if;

    insert into public.audit_events (
      company_id, actor_profile_id, action, entity_type, entity_id,
      previous_data, new_data
    ) values (
      target_company_id,
      auth.uid(),
      case
        when preceding_version_change = 'retired' then 'pricing.version_retired'
        else 'pricing.version_closed'
      end,
      'rate_card_version',
      preceding_version.id,
      to_jsonb(preceding_version),
      case
        when preceding_version_change = 'retired' then
          to_jsonb(preceding_version) || jsonb_build_object('status', 'retired')
        else
          to_jsonb(preceding_version) || jsonb_build_object(
            'effective_to', requested_effective_from - 1
          )
      end
    );
  end if;

  -- Anything still overlapping is not a simple predecessor/successor case
  -- (for example, a future scheduled version) and requires an explicit choice.
  if exists (
    select 1
    from public.rate_card_versions as published
    where published.rate_card_id = target_version.rate_card_id
      and published.company_id = target_company_id
      and published.id <> target_version_id
      and published.status = 'published'
      and daterange(
        published.effective_from,
        coalesce(published.effective_to, 'infinity'::date),
        '[]'
      ) && daterange(
        requested_effective_from,
        coalesce(requested_effective_to, 'infinity'::date),
        '[]'
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'La vigencia se superpone con otra versión futura ya publicada.';
  end if;

  update public.rate_card_versions
  set status = 'published',
      currency = requested_currency,
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
    target_company_id,
    auth.uid(),
    'pricing.version_published',
    'rate_card_version',
    target_version_id,
    jsonb_build_object(
      'effectiveFrom', requested_effective_from,
      'effectiveTo', requested_effective_to,
      'currency', requested_currency,
      'supersededVersionId', preceding_version.id,
      'supersededVersionChange', preceding_version_change
    )
  );

  return target_version_id;
end
$$;

revoke all on function public.publish_rate_card_version(
  uuid, date, date, text, text
) from public, anon, authenticated;
grant execute on function public.publish_rate_card_version(
  uuid, date, date, text, text
) to authenticated;

commit;

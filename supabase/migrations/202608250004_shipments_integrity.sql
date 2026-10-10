-- Normalize the shipment states used by the Phase 3 movement CRUD and prevent
-- duplicate tracking numbers inside a tenant.

begin;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'shipments_status_logispro_check'
      and conrelid = 'public.shipments'::regclass
  ) then
    alter table public.shipments
      add constraint shipments_status_logispro_check
      check (
        status is not null
        and status in ('pending', 'in_transit', 'delivered', 'incident')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'shipments_tracking_number_logispro_check'
      and conrelid = 'public.shipments'::regclass
  ) then
    alter table public.shipments
      add constraint shipments_tracking_number_logispro_check
      check (
        tracking_number is not null
        and char_length(btrim(tracking_number)) between 3 and 64
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'shipments_delivery_address_logispro_check'
      and conrelid = 'public.shipments'::regclass
  ) then
    alter table public.shipments
      add constraint shipments_delivery_address_logispro_check
      check (
        delivery_address is not null
        and nullif(btrim(delivery_address), '') is not null
      ) not valid;
  end if;
end
$$;

create unique index if not exists shipments_company_tracking_number_key
  on public.shipments (company_id, upper(btrim(tracking_number)));

commit;

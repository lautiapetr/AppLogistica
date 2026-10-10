-- Extend clients to support both companies and individuals. Optional fields use
-- NULL to mean "not provided"; no redundant boolean columns are necessary.

begin;

alter table public.clients
  add column if not exists client_type varchar(20) not null default 'company',
  add column if not exists first_name varchar(100),
  add column if not exists last_name varchar(100),
  add column if not exists document_number varchar(8),
  add column if not exists tax_id varchar(11),
  add column if not exists contact_phone varchar(40),
  add column if not exists address text;

-- Individuals use first_name/last_name instead of business_name.
alter table public.clients
  alter column business_name drop not null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'clients_type_logispro_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_type_logispro_check
      check (client_type in ('company', 'individual'));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'clients_required_name_logispro_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_required_name_logispro_check
      check (
        (
          client_type = 'company'
          and nullif(btrim(business_name), '') is not null
        )
        or
        (
          client_type = 'individual'
          and nullif(btrim(first_name), '') is not null
          and nullif(btrim(last_name), '') is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'clients_document_number_logispro_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_document_number_logispro_check
      check (document_number is null or document_number ~ '^[0-9]{7,8}$');
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'clients_tax_id_logispro_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_tax_id_logispro_check
      check (tax_id is null or tax_id ~ '^[0-9]{11}$');
  end if;
end
$$;

-- The same DNI or CUIT/CUIL may exist in different tenants, but not twice
-- inside one company.
create unique index if not exists clients_company_document_number_key
  on public.clients (company_id, document_number)
  where document_number is not null;

create unique index if not exists clients_company_tax_id_key
  on public.clients (company_id, tax_id)
  where tax_id is not null;

commit;

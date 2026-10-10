-- Phase 6: company-defined employee roles with database-enforced permissions.
-- Administrators remain protected system owners and always retain every
-- permission. Employee access is derived from their assigned company role.

begin;

create table public.permissions (
  key text primary key,
  module varchar(40) not null,
  label varchar(100) not null,
  description text not null,
  sort_order integer not null,
  constraint permissions_key_logispro_check
    check (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

insert into public.permissions (key, module, label, description, sort_order) values
  ('shipments.view', 'shipments', 'Ver movimientos', 'Consultar movimientos y sus detalles.', 10),
  ('shipments.create', 'shipments', 'Crear movimientos', 'Registrar nuevos movimientos.', 11),
  ('shipments.update', 'shipments', 'Editar movimientos', 'Modificar movimientos existentes.', 12),
  ('shipments.delete', 'shipments', 'Eliminar movimientos', 'Eliminar movimientos existentes.', 13),
  ('clients.view', 'clients', 'Ver clientes', 'Consultar el directorio de clientes.', 20),
  ('clients.manage', 'clients', 'Administrar clientes', 'Crear, editar y eliminar clientes.', 21),
  ('zones.view', 'zones', 'Ver zonas', 'Consultar zonas, grupos y ubicaciones.', 30),
  ('zones.manage', 'zones', 'Administrar zonas', 'Crear, editar y eliminar zonas y ubicaciones.', 31),
  ('statistics.view', 'statistics', 'Ver estadísticas', 'Consultar indicadores y gráficos operativos.', 40),
  ('statistics.export', 'statistics', 'Exportar estadísticas', 'Descargar movimientos filtrados en CSV.', 41),
  ('members.view', 'members', 'Ver equipo', 'Consultar miembros y solicitudes de ingreso.', 50),
  ('members.review', 'members', 'Administrar accesos', 'Aprobar, rechazar, suspender y reactivar empleados.', 51),
  ('members.manage_roles', 'members', 'Administrar roles', 'Crear roles, cambiar permisos y asignarlos.', 52),
  ('settings.view', 'settings', 'Ver configuración', 'Consultar la configuración de la empresa.', 60),
  ('settings.manage', 'settings', 'Administrar configuración', 'Modificar la configuración de la empresa.', 61),
  ('pricing.view', 'pricing', 'Ver valores económicos', 'Consultar tarifas y reglas económicas.', 70),
  ('pricing.manage', 'pricing', 'Administrar valores económicos', 'Crear y publicar tarifas y reglas económicas.', 71);

create table public.company_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name varchar(80) not null,
  description text,
  is_system boolean not null default false,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_roles_name_logispro_check
    check (char_length(btrim(name)) between 2 and 80),
  constraint company_roles_default_system_logispro_check
    check (not is_default or is_system)
);

create unique index company_roles_company_name_key
  on public.company_roles (company_id, lower(btrim(name)));
create unique index company_roles_one_default_key
  on public.company_roles (company_id)
  where is_default;

create table public.company_role_permissions (
  role_id uuid not null references public.company_roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete restrict,
  primary key (role_id, permission_key)
);

create index company_role_permissions_permission_idx
  on public.company_role_permissions (permission_key, role_id);

alter table public.profiles
  add column role_id uuid references public.company_roles(id) on delete restrict;

insert into public.company_roles (
  company_id, name, description, is_system, is_default, is_active
)
select
  company.id,
  'Empleado operativo',
  'Rol inicial con acceso a la operación diaria.',
  true,
  true,
  true
from public.companies as company;

insert into public.company_role_permissions (role_id, permission_key)
select role.id, permission_key
from public.company_roles as role
cross join unnest(array[
  'shipments.view',
  'shipments.create',
  'shipments.update',
  'shipments.delete',
  'clients.view',
  'zones.view',
  'statistics.view',
  'statistics.export'
]) as requested(permission_key)
where role.is_default;

update public.profiles as profile
set role_id = company_role.id
from public.company_roles as company_role
where profile.company_id = company_role.company_id
  and profile.role = 'employee'
  and company_role.is_default;

alter table public.profiles
  add constraint profiles_role_assignment_logispro_check
  check (
    (role = 'admin' and role_id is null)
    or (role = 'employee' and role_id is not null)
  );

create or replace function app_private.has_permission(
  target_company_id uuid,
  requested_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_company_id is not null and exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.company_id = target_company_id
      and profile.status = 'active'
      and (
        profile.role = 'admin'
        or (
          profile.role = 'employee'
          and exists (
            select 1
            from public.company_roles as company_role
            join public.company_role_permissions as role_permission
              on role_permission.role_id = company_role.id
            where company_role.id = profile.role_id
              and company_role.company_id = target_company_id
              and company_role.is_active
              and role_permission.permission_key = requested_permission
          )
        )
      )
  )
$$;

revoke all on function app_private.has_permission(uuid, text)
  from public, anon, authenticated;
grant execute on function app_private.has_permission(uuid, text) to authenticated;

create or replace function app_private.create_default_company_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_role_id uuid;
begin
  insert into public.company_roles (
    company_id, name, description, is_system, is_default, is_active
  ) values (
    new.id,
    'Empleado operativo',
    'Rol inicial con acceso a la operación diaria.',
    true,
    true,
    true
  ) returning id into new_role_id;

  insert into public.company_role_permissions (role_id, permission_key)
  select new_role_id, permission_key
  from unnest(array[
    'shipments.view',
    'shipments.create',
    'shipments.update',
    'shipments.delete',
    'clients.view',
    'zones.view',
    'statistics.view',
    'statistics.export'
  ]) as requested(permission_key);

  return new;
end
$$;

drop trigger if exists create_default_company_role on public.companies;
create trigger create_default_company_role
after insert on public.companies
for each row execute function app_private.create_default_company_role();

create or replace function app_private.validate_profile_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'admin' then
    new.role_id := null;
    return new;
  end if;

  if new.role_id is null then
    select company_role.id
    into new.role_id
    from public.company_roles as company_role
    where company_role.company_id = new.company_id
      and company_role.is_default
      and company_role.is_active;
  end if;

  if new.role_id is null or not exists (
    select 1
    from public.company_roles as company_role
    where company_role.id = new.role_id
      and company_role.company_id = new.company_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'The selected employee role does not belong to this company.';
  end if;

  return new;
end
$$;

drop trigger if exists validate_profile_role_assignment on public.profiles;
create trigger validate_profile_role_assignment
before insert or update of role, role_id, company_id on public.profiles
for each row execute function app_private.validate_profile_role_assignment();

create or replace function app_private.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    return new;
  end if;

  if old.id = current_user_id then
    new.full_name := btrim(new.full_name);

    if new.full_name is null or char_length(new.full_name) not between 2 and 120 then
      raise exception using errcode = '22023', message = 'Full name must contain between 2 and 120 characters.';
    end if;

    if (to_jsonb(new) - 'full_name' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'full_name' - 'updated_at') then
      raise exception using errcode = '42501', message = 'Users may only update their own full name.';
    end if;

    return new;
  end if;

  if old.role = 'employee'
     and app_private.is_active_company_member(old.company_id) then
    if new.status is distinct from old.status
       and not app_private.has_permission(old.company_id, 'members.review') then
      raise exception using errcode = '42501', message = 'You do not have permission to manage employee access.';
    end if;

    if new.role_id is distinct from old.role_id
       and not app_private.has_permission(old.company_id, 'members.manage_roles') then
      raise exception using errcode = '42501', message = 'You do not have permission to assign employee roles.';
    end if;

    if (to_jsonb(new) - 'status' - 'role_id' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'status' - 'role_id' - 'updated_at') then
      raise exception using errcode = '42501', message = 'This employee profile contains protected changes.';
    end if;

    return new;
  end if;

  raise exception using errcode = '42501', message = 'This profile cannot be updated by the current user.';
end
$$;

revoke all on function app_private.create_default_company_role() from public, anon, authenticated;
revoke all on function app_private.validate_profile_role_assignment() from public, anon, authenticated;
revoke all on function app_private.guard_profile_update() from public, anon, authenticated;

create or replace function app_private.audit_employee_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role_id is not distinct from new.role_id then
    return new;
  end if;

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_type, entity_id,
    previous_data, new_data
  ) values (
    new.company_id,
    auth.uid(),
    'membership.role_assigned',
    'profile',
    new.id,
    jsonb_build_object('role_id', old.role_id),
    jsonb_build_object('role_id', new.role_id)
  );

  return new;
end
$$;

drop trigger if exists audit_employee_role_change on public.profiles;
create trigger audit_employee_role_change
after update of role_id on public.profiles
for each row execute function app_private.audit_employee_role_change();

revoke all on function app_private.audit_employee_role_change() from public, anon, authenticated;

alter table public.permissions enable row level security;
alter table public.permissions force row level security;
alter table public.company_roles enable row level security;
alter table public.company_roles force row level security;
alter table public.company_role_permissions enable row level security;
alter table public.company_role_permissions force row level security;

create policy permissions_select_active
on public.permissions for select to authenticated
using (app_private.current_company_id() is not null);

create policy company_roles_select_tenant
on public.company_roles for select to authenticated
using (app_private.is_active_company_member(company_id));

create policy company_role_permissions_select_tenant
on public.company_role_permissions for select to authenticated
using (exists (
  select 1
  from public.company_roles as company_role
  where company_role.id = role_id
    and app_private.is_active_company_member(company_role.company_id)
));

revoke all on table public.permissions from anon, authenticated;
revoke all on table public.company_roles from anon, authenticated;
revoke all on table public.company_role_permissions from anon, authenticated;
grant select on table public.permissions to authenticated;
grant select on table public.company_roles to authenticated;
grant select on table public.company_role_permissions to authenticated;

-- Replace broad tenant policies with permission-aware policies.
drop policy if exists profiles_select_tenant on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;

create policy profiles_select_authorized
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or (
    app_private.is_active_company_member(company_id)
    and app_private.has_permission(company_id, 'members.view')
  )
);

create policy profiles_update_manager
on public.profiles for update to authenticated
using (
  role = 'employee'
  and app_private.is_active_company_member(company_id)
  and (
    app_private.has_permission(company_id, 'members.review')
    or app_private.has_permission(company_id, 'members.manage_roles')
  )
)
with check (
  role = 'employee'
  and app_private.is_active_company_member(company_id)
  and (
    app_private.has_permission(company_id, 'members.review')
    or app_private.has_permission(company_id, 'members.manage_roles')
  )
);

drop policy if exists clients_select_tenant on public.clients;
drop policy if exists clients_insert_admin on public.clients;
drop policy if exists clients_update_admin on public.clients;
drop policy if exists clients_delete_admin on public.clients;
create policy clients_select_permitted on public.clients for select to authenticated
  using (app_private.has_permission(company_id, 'clients.view'));
create policy clients_insert_permitted on public.clients for insert to authenticated
  with check (app_private.has_permission(company_id, 'clients.manage'));
create policy clients_update_permitted on public.clients for update to authenticated
  using (app_private.has_permission(company_id, 'clients.manage'))
  with check (app_private.has_permission(company_id, 'clients.manage'));
create policy clients_delete_permitted on public.clients for delete to authenticated
  using (app_private.has_permission(company_id, 'clients.manage'));

drop policy if exists zones_select_tenant on public.zones;
drop policy if exists zones_insert_admin on public.zones;
drop policy if exists zones_update_admin on public.zones;
drop policy if exists zones_delete_admin on public.zones;
create policy zones_select_permitted on public.zones for select to authenticated
  using (app_private.has_permission(company_id, 'zones.view'));
create policy zones_insert_permitted on public.zones for insert to authenticated
  with check (app_private.has_permission(company_id, 'zones.manage'));
create policy zones_update_permitted on public.zones for update to authenticated
  using (app_private.has_permission(company_id, 'zones.manage'))
  with check (app_private.has_permission(company_id, 'zones.manage'));
create policy zones_delete_permitted on public.zones for delete to authenticated
  using (app_private.has_permission(company_id, 'zones.manage'));

drop policy if exists zone_locations_select_tenant on public.zone_locations;
drop policy if exists zone_locations_insert_admin on public.zone_locations;
drop policy if exists zone_locations_update_admin on public.zone_locations;
drop policy if exists zone_locations_delete_admin on public.zone_locations;
create policy zone_locations_select_permitted on public.zone_locations for select to authenticated
  using (app_private.has_permission(company_id, 'zones.view'));
create policy zone_locations_insert_permitted on public.zone_locations for insert to authenticated
  with check (app_private.has_permission(company_id, 'zones.manage'));
create policy zone_locations_update_permitted on public.zone_locations for update to authenticated
  using (app_private.has_permission(company_id, 'zones.manage'))
  with check (app_private.has_permission(company_id, 'zones.manage'));
create policy zone_locations_delete_permitted on public.zone_locations for delete to authenticated
  using (app_private.has_permission(company_id, 'zones.manage'));

drop policy if exists shipments_select_tenant on public.shipments;
drop policy if exists shipments_insert_tenant on public.shipments;
drop policy if exists shipments_update_tenant on public.shipments;
drop policy if exists shipments_delete_tenant on public.shipments;
create policy shipments_select_permitted on public.shipments for select to authenticated
  using (app_private.has_permission(company_id, 'shipments.view'));
create policy shipments_insert_permitted on public.shipments for insert to authenticated
  with check (app_private.has_permission(company_id, 'shipments.create'));
create policy shipments_update_permitted on public.shipments for update to authenticated
  using (app_private.has_permission(company_id, 'shipments.update'))
  with check (app_private.has_permission(company_id, 'shipments.update'));
create policy shipments_delete_permitted on public.shipments for delete to authenticated
  using (app_private.has_permission(company_id, 'shipments.delete'));

create or replace function public.get_my_permissions()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile public.profiles%rowtype;
  effective_permissions text[];
begin
  select * into current_profile
  from public.profiles
  where id = auth.uid();

  if current_profile.id is null or current_profile.status <> 'active' then
    return array[]::text[];
  end if;

  if current_profile.role = 'admin' then
    select coalesce(array_agg(permission.key order by permission.sort_order), array[]::text[])
    into effective_permissions
    from public.permissions as permission;
  else
    select coalesce(array_agg(role_permission.permission_key order by permission.sort_order), array[]::text[])
    into effective_permissions
    from public.company_roles as company_role
    join public.company_role_permissions as role_permission
      on role_permission.role_id = company_role.id
    join public.permissions as permission
      on permission.key = role_permission.permission_key
    where company_role.id = current_profile.role_id
      and company_role.company_id = current_profile.company_id
      and company_role.is_active;
  end if;

  return effective_permissions;
end
$$;

create or replace function public.get_roles_and_permissions()
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
     or not app_private.has_permission(target_company_id, 'members.manage_roles') then
    raise exception using errcode = '42501', message = 'You do not have permission to manage roles.';
  end if;

  select jsonb_build_object(
    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', permission.key,
        'module', permission.module,
        'label', permission.label,
        'description', permission.description
      ) order by permission.sort_order)
      from public.permissions as permission
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', company_role.id,
        'companyId', company_role.company_id,
        'name', company_role.name,
        'description', company_role.description,
        'isSystem', company_role.is_system,
        'isDefault', company_role.is_default,
        'isActive', company_role.is_active,
        'memberCount', (
          select count(*)
          from public.profiles as profile
          where profile.role_id = company_role.id
            and profile.role = 'employee'
        ),
        'permissionKeys', coalesce((
          select jsonb_agg(role_permission.permission_key order by permission.sort_order)
          from public.company_role_permissions as role_permission
          join public.permissions as permission
            on permission.key = role_permission.permission_key
          where role_permission.role_id = company_role.id
        ), '[]'::jsonb)
      ) order by company_role.is_default desc, company_role.name)
      from public.company_roles as company_role
      where company_role.company_id = target_company_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end
$$;

create or replace function public.save_company_role(
  target_role_id uuid,
  role_name text,
  role_description text,
  requested_permission_keys text[],
  requested_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  saved_role public.company_roles%rowtype;
  normalized_permission_keys text[];
  previous_role jsonb;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'members.manage_roles') then
    raise exception using errcode = '42501', message = 'You do not have permission to manage roles.';
  end if;

  role_name := btrim(role_name);
  role_description := nullif(btrim(role_description), '');
  requested_is_active := coalesce(requested_is_active, true);

  if role_name is null or char_length(role_name) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'Role name must contain between 2 and 80 characters.';
  end if;

  select coalesce(array_agg(distinct permission_key), array[]::text[])
  into normalized_permission_keys
  from unnest(coalesce(requested_permission_keys, array[]::text[])) as requested(permission_key);

  if exists (
    select 1
    from unnest(normalized_permission_keys) as requested(requested_key)
    where not exists (
      select 1 from public.permissions where key = requested_key
    )
  ) then
    raise exception using errcode = '22023', message = 'The role contains an unknown permission.';
  end if;

  if (
    ('clients.manage' = any(normalized_permission_keys) and not ('clients.view' = any(normalized_permission_keys)))
    or ('zones.manage' = any(normalized_permission_keys) and not ('zones.view' = any(normalized_permission_keys)))
    or ('statistics.view' = any(normalized_permission_keys) and not ('shipments.view' = any(normalized_permission_keys)))
    or ('statistics.export' = any(normalized_permission_keys) and not ('statistics.view' = any(normalized_permission_keys)))
    or ('members.review' = any(normalized_permission_keys) and not ('members.view' = any(normalized_permission_keys)))
    or ('members.manage_roles' = any(normalized_permission_keys) and not ('members.view' = any(normalized_permission_keys)))
    or ('settings.manage' = any(normalized_permission_keys) and not ('settings.view' = any(normalized_permission_keys)))
    or ('pricing.manage' = any(normalized_permission_keys) and not ('pricing.view' = any(normalized_permission_keys)))
    or (
      ('shipments.create' = any(normalized_permission_keys)
       or 'shipments.update' = any(normalized_permission_keys)
       or 'shipments.delete' = any(normalized_permission_keys))
      and not ('shipments.view' = any(normalized_permission_keys))
    )
    or (
      ('shipments.create' = any(normalized_permission_keys)
       or 'shipments.update' = any(normalized_permission_keys))
      and (
        not ('clients.view' = any(normalized_permission_keys))
        or not ('zones.view' = any(normalized_permission_keys))
      )
    )
  ) then
    raise exception using errcode = '22023', message = 'The selected permissions are missing a required view permission.';
  end if;

  if target_role_id is null then
    insert into public.company_roles (
      company_id, name, description, is_system, is_default, is_active
    ) values (
      target_company_id, role_name, role_description, false, false, requested_is_active
    ) returning * into saved_role;

    previous_role := null;
  else
    select *
    into saved_role
    from public.company_roles as company_role
    where company_role.id = target_role_id
      and company_role.company_id = target_company_id
    for update;

    if saved_role.id is null then
      raise exception using errcode = '22023', message = 'The selected role does not belong to this company.';
    end if;

    previous_role := to_jsonb(saved_role);

    if saved_role.is_system and (
      role_name is distinct from saved_role.name
      or requested_is_active is false
    ) then
      raise exception using errcode = '42501', message = 'The system employee role cannot be renamed or deactivated.';
    end if;

    if requested_is_active is false and exists (
      select 1 from public.profiles
      where role_id = target_role_id and role = 'employee'
    ) then
      raise exception using errcode = '23503', message = 'Reassign this role employees before deactivating it.';
    end if;

    update public.company_roles
    set name = role_name,
        description = role_description,
        is_active = requested_is_active,
        updated_at = now()
    where id = target_role_id
    returning * into saved_role;
  end if;

  delete from public.company_role_permissions where role_id = saved_role.id;
  insert into public.company_role_permissions (role_id, permission_key)
  select saved_role.id, permission_key
  from unnest(normalized_permission_keys) as requested(permission_key);

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_type, entity_id,
    previous_data, new_data
  ) values (
    target_company_id,
    auth.uid(),
    case when target_role_id is null then 'role.created' else 'role.updated' end,
    'company_role',
    saved_role.id,
    previous_role,
    to_jsonb(saved_role) || jsonb_build_object('permission_keys', normalized_permission_keys)
  );

  return to_jsonb(saved_role) || jsonb_build_object('permissionKeys', normalized_permission_keys);
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'A role with this name already exists.';
end
$$;

create or replace function public.assign_employee_role(
  target_profile_id uuid,
  target_role_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  assigned_profile public.profiles%rowtype;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'members.manage_roles') then
    raise exception using errcode = '42501', message = 'You do not have permission to assign employee roles.';
  end if;

  if not exists (
    select 1 from public.company_roles
    where id = target_role_id
      and company_id = target_company_id
      and is_active
  ) then
    raise exception using errcode = '22023', message = 'Select an active role from this company.';
  end if;

  update public.profiles
  set role_id = target_role_id
  where id = target_profile_id
    and company_id = target_company_id
    and role = 'employee'
  returning * into assigned_profile;

  if assigned_profile.id is null then
    raise exception using errcode = '42501', message = 'The selected employee does not belong to this company.';
  end if;

  return to_jsonb(assigned_profile);
end
$$;

create or replace function public.review_membership_request(
  target_profile_id uuid,
  decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  reviewed_profile public.profiles%rowtype;
begin
  decision := lower(btrim(decision));

  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'members.review') then
    raise exception using errcode = '42501', message = 'You do not have permission to review membership requests.';
  end if;

  if decision not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'Decision must be approve or reject.';
  end if;

  update public.profiles
  set status = case decision when 'approve' then 'active' else 'rejected' end
  where id = target_profile_id
    and company_id = target_company_id
    and role = 'employee'
    and status = 'pending'
  returning * into reviewed_profile;

  if reviewed_profile.id is null then
    raise exception using errcode = '22023', message = 'The membership request is no longer pending or does not belong to this company.';
  end if;

  return to_jsonb(reviewed_profile);
end
$$;

create or replace function public.manage_employee_access(
  target_profile_id uuid,
  requested_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  managed_profile public.profiles%rowtype;
begin
  requested_status := lower(btrim(requested_status));

  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'members.review') then
    raise exception using errcode = '42501', message = 'You do not have permission to manage employee access.';
  end if;

  if requested_status not in ('active', 'suspended') then
    raise exception using errcode = '22023', message = 'Requested status must be active or suspended.';
  end if;

  update public.profiles
  set status = requested_status
  where id = target_profile_id
    and company_id = target_company_id
    and role = 'employee'
    and (
      (requested_status = 'suspended' and status = 'active')
      or (requested_status = 'active' and status in ('suspended', 'rejected'))
    )
  returning * into managed_profile;

  if managed_profile.id is null then
    raise exception using errcode = '22023', message = 'This employee access transition is not allowed.';
  end if;

  return to_jsonb(managed_profile);
end
$$;

create or replace function app_private.notify_pending_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'employee' and new.status = 'pending' then
    insert into public.notifications (
      company_id, recipient_profile_id, type, title, body,
      entity_type, entity_id, metadata
    )
    select
      new.company_id,
      reviewer.id,
      'membership_request',
      'Nueva solicitud de ingreso',
      new.full_name || ' quiere unirse a la empresa.',
      'profile',
      new.id,
      jsonb_build_object('employee_name', new.full_name)
    from public.profiles as reviewer
    where reviewer.company_id = new.company_id
      and reviewer.status = 'active'
      and (
        reviewer.role = 'admin'
        or exists (
          select 1
          from public.company_roles as company_role
          join public.company_role_permissions as role_permission
            on role_permission.role_id = company_role.id
          where company_role.id = reviewer.role_id
            and company_role.is_active
            and role_permission.permission_key = 'members.review'
        )
      );
  end if;

  return new;
end
$$;

revoke all on function app_private.notify_pending_membership() from public, anon, authenticated;

-- Keep the original statistics functions private and expose permission-aware
-- wrappers, so their already validated aggregation logic remains unchanged.
create or replace function public.get_authorized_operational_statistics(
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
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'statistics.view') then
    raise exception using errcode = '42501', message = 'You do not have permission to view statistics.';
  end if;

  return public.get_operational_statistics(
    requested_date_from,
    requested_date_to,
    requested_status,
    requested_zone_id,
    requested_client_id,
    requested_destination_place_id
  );
end
$$;

create or replace function public.get_authorized_statistics_filter_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'statistics.view') then
    raise exception using errcode = '42501', message = 'You do not have permission to view statistics.';
  end if;

  return public.get_statistics_filter_options();
end
$$;

create or replace function public.get_operational_statistics_export(
  requested_date_from date,
  requested_date_to date,
  requested_status text,
  requested_zone_id uuid,
  requested_client_id uuid,
  requested_destination_place_id text,
  requested_offset integer,
  requested_limit integer
)
returns table (
  tracking_number text,
  shipment_date date,
  status text,
  delivery_address text,
  destination_city text,
  destination_place_id text,
  client_id uuid,
  zone_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
begin
  requested_status := nullif(btrim(requested_status), '');
  requested_destination_place_id := nullif(btrim(requested_destination_place_id), '');
  requested_offset := coalesce(requested_offset, 0);
  requested_limit := coalesce(requested_limit, 1000);

  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'statistics.export') then
    raise exception using errcode = '42501', message = 'You do not have permission to export statistics.';
  end if;

  if requested_date_from is null or requested_date_to is null
     or requested_date_from > requested_date_to
     or requested_date_to - requested_date_from > 365 then
    raise exception using errcode = '22023', message = 'A valid export date range of up to 366 days is required.';
  end if;

  if requested_status is not null
     and requested_status not in ('pending', 'in_transit', 'delivered', 'incident') then
    raise exception using errcode = '22023', message = 'Invalid shipment status filter.';
  end if;

  if requested_offset < 0 or requested_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Invalid export pagination.';
  end if;

  return query
  select
    shipment.tracking_number::text,
    shipment.shipment_date,
    shipment.status::text,
    shipment.delivery_address::text,
    shipment.destination_city::text,
    shipment.destination_place_id::text,
    shipment.client_id,
    shipment.zone_id
  from public.shipments as shipment
  where shipment.company_id = target_company_id
    and shipment.shipment_date between requested_date_from and requested_date_to
    and (requested_status is null or shipment.status = requested_status)
    and (requested_zone_id is null or shipment.zone_id = requested_zone_id)
    and (requested_client_id is null or shipment.client_id = requested_client_id)
    and (
      requested_destination_place_id is null
      or shipment.destination_place_id = requested_destination_place_id
    )
  order by shipment.shipment_date, shipment.tracking_number
  offset requested_offset
  limit requested_limit;
end
$$;

create or replace function public.save_authorized_shipment_with_destination(
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
  city_longitude double precision
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
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, required_permission) then
    raise exception using errcode = '42501', message = 'You do not have permission to save this movement.';
  end if;

  return public.save_shipment_with_destination(
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
end
$$;

create or replace function public.save_zone_configuration(
  target_zone_id uuid,
  zone_name text,
  requested_zone_type text,
  zone_color text,
  zone_latitude double precision,
  zone_longitude double precision,
  zone_mapbox_place_id text,
  zone_place_label text,
  zone_locations jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  saved_zone_id uuid;
  location_data jsonb;
  location_name text;
  location_type text;
  location_latitude double precision;
  location_longitude double precision;
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'zones.manage') then
    raise exception using errcode = '42501', message = 'You do not have permission to configure zones.';
  end if;

  zone_name := btrim(zone_name);
  zone_mapbox_place_id := nullif(btrim(zone_mapbox_place_id), '');
  zone_place_label := nullif(btrim(zone_place_label), '');

  if zone_name is null or char_length(zone_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Zone name must contain between 2 and 120 characters.';
  end if;

  if requested_zone_type not in ('group', 'city') then
    raise exception using errcode = '22023', message = 'Zone type must be group or city.';
  end if;

  if zone_color not in ('violet', 'blue', 'emerald', 'amber', 'rose') then
    raise exception using errcode = '22023', message = 'Invalid zone color.';
  end if;

  if jsonb_typeof(coalesce(zone_locations, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Zone locations must be an array.';
  end if;

  if requested_zone_type = 'city' and (
    zone_latitude is null or zone_longitude is null
    or zone_latitude not between -90 and 90
    or zone_longitude not between -180 and 180
  ) then
    raise exception using errcode = '22023', message = 'An individual city requires valid coordinates.';
  end if;

  if requested_zone_type = 'group' then
    zone_latitude := null;
    zone_longitude := null;
    zone_mapbox_place_id := null;
    zone_place_label := null;
  end if;

  if target_zone_id is null then
    insert into public.zones (
      company_id, name, zone_type, color, latitude, longitude,
      mapbox_place_id, place_label
    ) values (
      target_company_id, zone_name, requested_zone_type, zone_color,
      zone_latitude, zone_longitude, zone_mapbox_place_id, zone_place_label
    ) returning id into saved_zone_id;
  else
    if not exists (
      select 1 from public.zones
      where id = target_zone_id and company_id = target_company_id
    ) then
      raise exception using errcode = '42501', message = 'The selected zone does not belong to this company.';
    end if;

    update public.zones
    set name = zone_name,
        zone_type = requested_zone_type,
        color = zone_color,
        latitude = zone_latitude,
        longitude = zone_longitude,
        mapbox_place_id = zone_mapbox_place_id,
        place_label = zone_place_label
    where id = target_zone_id;

    saved_zone_id := target_zone_id;
  end if;

  delete from public.zone_locations where group_zone_id = saved_zone_id;

  if requested_zone_type = 'group' then
    for location_data in
      select value from jsonb_array_elements(coalesce(zone_locations, '[]'::jsonb))
    loop
      location_name := btrim(location_data ->> 'name');
      location_type := location_data ->> 'location_type';
      location_latitude := (location_data ->> 'latitude')::double precision;
      location_longitude := (location_data ->> 'longitude')::double precision;

      if location_name is null or char_length(location_name) not between 2 and 120
         or location_type not in ('city', 'custom')
         or location_latitude not between -90 and 90
         or location_longitude not between -180 and 180 then
        raise exception using errcode = '22023', message = 'A group contains an invalid location.';
      end if;

      insert into public.zone_locations (
        company_id, group_zone_id, location_type, name, mapbox_place_id,
        place_label, latitude, longitude
      ) values (
        target_company_id,
        saved_zone_id,
        location_type,
        location_name,
        nullif(btrim(location_data ->> 'mapbox_place_id'), ''),
        nullif(btrim(location_data ->> 'place_label'), ''),
        location_latitude,
        location_longitude
      );
    end loop;
  end if;

  return saved_zone_id;
end
$$;

revoke all on function public.get_my_permissions() from public, anon, authenticated;
revoke all on function public.get_roles_and_permissions() from public, anon, authenticated;
revoke all on function public.save_company_role(uuid, text, text, text[], boolean)
  from public, anon, authenticated;
revoke all on function public.assign_employee_role(uuid, uuid)
  from public, anon, authenticated;

revoke all on function public.get_operational_statistics(
  date, date, text, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.get_statistics_filter_options()
  from public, anon, authenticated;
revoke all on function public.get_authorized_operational_statistics(
  date, date, text, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.get_authorized_statistics_filter_options()
  from public, anon, authenticated;
revoke all on function public.get_operational_statistics_export(
  date, date, text, uuid, uuid, text, integer, integer
) from public, anon, authenticated;

revoke all on function public.save_shipment_with_destination(
  uuid, text, uuid, text, text, date, text, text, text,
  double precision, double precision
) from public, anon, authenticated;
revoke all on function public.save_authorized_shipment_with_destination(
  uuid, text, uuid, text, text, date, text, text, text,
  double precision, double precision
) from public, anon, authenticated;
revoke all on function public.save_zone_configuration(
  uuid, text, text, text, double precision, double precision, text, text, jsonb
) from public, anon, authenticated;

revoke all on function public.review_membership_request(uuid, text)
  from public, anon, authenticated;
revoke all on function public.manage_employee_access(uuid, text)
  from public, anon, authenticated;

grant execute on function public.get_my_permissions() to authenticated;
grant execute on function public.get_roles_and_permissions() to authenticated;
grant execute on function public.save_company_role(uuid, text, text, text[], boolean)
  to authenticated;
grant execute on function public.assign_employee_role(uuid, uuid) to authenticated;
grant execute on function public.get_authorized_operational_statistics(
  date, date, text, uuid, uuid, text
) to authenticated;
grant execute on function public.get_authorized_statistics_filter_options()
  to authenticated;
grant execute on function public.get_operational_statistics_export(
  date, date, text, uuid, uuid, text, integer, integer
) to authenticated;
grant execute on function public.save_authorized_shipment_with_destination(
  uuid, text, uuid, text, text, date, text, text, text,
  double precision, double precision
) to authenticated;
grant execute on function public.save_zone_configuration(
  uuid, text, text, text, double precision, double precision, text, text, jsonb
) to authenticated;
grant execute on function public.review_membership_request(uuid, text) to authenticated;
grant execute on function public.manage_employee_access(uuid, text) to authenticated;

commit;

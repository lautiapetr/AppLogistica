-- Phase 7: tenant branding, operational defaults, personal preferences, and
-- private Storage policies for company logos and profile avatars.

begin;

create table public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  display_name varchar(120) not null,
  logo_path text,
  contact_email text,
  contact_phone varchar(40),
  address text,
  timezone varchar(80) not null default 'America/Argentina/Buenos_Aires',
  locale varchar(10) not null default 'es-AR',
  currency char(3) not null default 'ARS',
  date_format varchar(20) not null default 'DD/MM/YYYY',
  mapbox_center_latitude double precision not null default -34.6037,
  mapbox_center_longitude double precision not null default -58.3816,
  mapbox_default_zoom double precision not null default 5,
  primary_color varchar(7) not null default '#5600FF',
  accent_color varchar(7) not null default '#8B3DFF',
  default_theme varchar(10) not null default 'light',
  table_density varchar(12) not null default 'comfortable',
  sidebar_default_collapsed boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_settings_display_name_check
    check (char_length(btrim(display_name)) between 2 and 120),
  constraint company_settings_contact_email_check
    check (contact_email is null or contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint company_settings_timezone_check
    check (timezone in (
      'America/Argentina/Buenos_Aires',
      'America/Argentina/Cordoba',
      'America/Argentina/Mendoza',
      'America/Argentina/Salta',
      'America/Argentina/Ushuaia'
    )),
  constraint company_settings_locale_check
    check (locale in ('es-AR', 'en-US', 'pt-BR')),
  constraint company_settings_currency_check
    check (currency in ('ARS', 'USD', 'EUR', 'BRL')),
  constraint company_settings_date_format_check
    check (date_format in ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD')),
  constraint company_settings_coordinates_check
    check (
      mapbox_center_latitude between -90 and 90
      and mapbox_center_longitude between -180 and 180
      and mapbox_default_zoom between 1 and 20
    ),
  constraint company_settings_colors_check
    check (
      primary_color ~ '^#[0-9A-Fa-f]{6}$'
      and accent_color ~ '^#[0-9A-Fa-f]{6}$'
    ),
  constraint company_settings_theme_check
    check (default_theme in ('light', 'dark', 'system')),
  constraint company_settings_density_check
    check (table_density in ('comfortable', 'compact')),
  constraint company_settings_logo_path_check
    check (logo_path is null or logo_path = company_id::text || '/logo')
);

create table public.user_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  avatar_path text,
  theme_preference varchar(10) not null default 'company',
  table_density varchar(12) not null default 'company',
  sidebar_preference varchar(10) not null default 'company',
  notifications_enabled boolean not null default true,
  membership_notifications boolean not null default true,
  default_landing_page varchar(20) not null default 'movements',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_avatar_path_check
    check (avatar_path is null or avatar_path = profile_id::text || '/avatar'),
  constraint user_preferences_theme_check
    check (theme_preference in ('company', 'light', 'dark', 'system')),
  constraint user_preferences_density_check
    check (table_density in ('company', 'comfortable', 'compact')),
  constraint user_preferences_sidebar_check
    check (sidebar_preference in ('company', 'expanded', 'collapsed')),
  constraint user_preferences_landing_check
    check (default_landing_page in (
      'movements', 'statistics', 'clients', 'zones', 'team', 'roles', 'pricing', 'settings'
    ))
);

insert into public.company_settings (company_id, display_name)
select company.id, company.name
from public.companies as company;

insert into public.user_preferences (profile_id)
select profile.id
from public.profiles as profile;

-- Personal settings should be available to employees using the protected
-- default role. Companies may still remove this permission later.
insert into public.company_role_permissions (role_id, permission_key)
select company_role.id, 'settings.view'
from public.company_roles as company_role
where company_role.is_default
on conflict do nothing;

create or replace function app_private.create_company_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company_settings (company_id, display_name)
  values (new.id, new.name);
  return new;
end
$$;

drop trigger if exists create_company_settings on public.companies;
create trigger create_company_settings
after insert on public.companies
for each row execute function app_private.create_company_settings();

create or replace function app_private.create_user_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_preferences (profile_id) values (new.id);
  return new;
end
$$;

drop trigger if exists create_user_preferences on public.profiles;
create trigger create_user_preferences
after insert on public.profiles
for each row execute function app_private.create_user_preferences();

revoke all on function app_private.create_company_settings() from public, anon, authenticated;
revoke all on function app_private.create_user_preferences() from public, anon, authenticated;

alter table public.company_settings enable row level security;
alter table public.company_settings force row level security;
alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;

create policy company_settings_select_tenant
on public.company_settings for select to authenticated
using (app_private.is_active_company_member(company_id));

create policy user_preferences_select_own
on public.user_preferences for select to authenticated
using (profile_id = (select auth.uid()));

revoke all on table public.company_settings from anon, authenticated;
revoke all on table public.user_preferences from anon, authenticated;
grant select on table public.company_settings to authenticated;
grant select on table public.user_preferences to authenticated;

create or replace function public.get_app_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  current_user_id uuid := auth.uid();
  result jsonb;
begin
  if target_company_id is null or current_user_id is null then
    raise exception using errcode = '42501', message = 'An active company profile is required.';
  end if;

  select jsonb_build_object(
    'company', jsonb_build_object(
      'companyId', company_setting.company_id,
      'displayName', company_setting.display_name,
      'logoPath', company_setting.logo_path,
      'contactEmail', company_setting.contact_email,
      'contactPhone', company_setting.contact_phone,
      'address', company_setting.address,
      'timezone', company_setting.timezone,
      'locale', company_setting.locale,
      'currency', btrim(company_setting.currency),
      'dateFormat', company_setting.date_format,
      'mapboxCenterLatitude', company_setting.mapbox_center_latitude,
      'mapboxCenterLongitude', company_setting.mapbox_center_longitude,
      'mapboxDefaultZoom', company_setting.mapbox_default_zoom,
      'primaryColor', upper(company_setting.primary_color),
      'accentColor', upper(company_setting.accent_color),
      'defaultTheme', company_setting.default_theme,
      'tableDensity', company_setting.table_density,
      'sidebarDefaultCollapsed', company_setting.sidebar_default_collapsed
    ),
    'user', jsonb_build_object(
      'profileId', user_preference.profile_id,
      'avatarPath', user_preference.avatar_path,
      'themePreference', user_preference.theme_preference,
      'tableDensity', user_preference.table_density,
      'sidebarPreference', user_preference.sidebar_preference,
      'notificationsEnabled', user_preference.notifications_enabled,
      'membershipNotifications', user_preference.membership_notifications,
      'defaultLandingPage', user_preference.default_landing_page
    )
  ) into result
  from public.company_settings as company_setting
  join public.user_preferences as user_preference
    on user_preference.profile_id = current_user_id
  where company_setting.company_id = target_company_id;

  if result is null then
    raise exception using errcode = 'P0001', message = 'Application settings are not initialized.';
  end if;

  return result;
end
$$;

create or replace function public.save_company_settings(requested_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := app_private.current_company_id();
  saved_settings public.company_settings%rowtype;
  previous_settings jsonb;
  requested_logo_path text := nullif(btrim(requested_settings ->> 'logoPath'), '');
begin
  if target_company_id is null
     or not app_private.has_permission(target_company_id, 'settings.manage') then
    raise exception using errcode = '42501', message = 'You do not have permission to manage company settings.';
  end if;

  if requested_settings is null or jsonb_typeof(requested_settings) <> 'object' then
    raise exception using errcode = '22023', message = 'Company settings must be an object.';
  end if;

  if requested_logo_path is not null
     and requested_logo_path <> (target_company_id::text || '/logo') then
    raise exception using errcode = '22023', message = 'Invalid company logo path.';
  end if;

  select to_jsonb(company_setting)
  into previous_settings
  from public.company_settings as company_setting
  where company_setting.company_id = target_company_id
  for update;

  update public.company_settings
  set display_name = btrim(requested_settings ->> 'displayName'),
      logo_path = requested_logo_path,
      contact_email = nullif(btrim(requested_settings ->> 'contactEmail'), ''),
      contact_phone = nullif(btrim(requested_settings ->> 'contactPhone'), ''),
      address = nullif(btrim(requested_settings ->> 'address'), ''),
      timezone = requested_settings ->> 'timezone',
      locale = requested_settings ->> 'locale',
      currency = upper(requested_settings ->> 'currency'),
      date_format = requested_settings ->> 'dateFormat',
      mapbox_center_latitude = (requested_settings ->> 'mapboxCenterLatitude')::double precision,
      mapbox_center_longitude = (requested_settings ->> 'mapboxCenterLongitude')::double precision,
      mapbox_default_zoom = (requested_settings ->> 'mapboxDefaultZoom')::double precision,
      primary_color = upper(requested_settings ->> 'primaryColor'),
      accent_color = upper(requested_settings ->> 'accentColor'),
      default_theme = requested_settings ->> 'defaultTheme',
      table_density = requested_settings ->> 'tableDensity',
      sidebar_default_collapsed = (requested_settings ->> 'sidebarDefaultCollapsed')::boolean,
      updated_by = auth.uid(),
      updated_at = now()
  where company_id = target_company_id
  returning * into saved_settings;

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_type, entity_id,
    previous_data, new_data
  ) values (
    target_company_id,
    auth.uid(),
    'settings.company_updated',
    'company_settings',
    target_company_id,
    previous_settings,
    to_jsonb(saved_settings)
  );

  return public.get_app_settings() -> 'company';
exception
  when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'One or more company settings are invalid.';
end
$$;

create or replace function public.save_user_preferences(requested_preferences jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_company_id uuid := app_private.current_company_id();
  saved_preferences public.user_preferences%rowtype;
  requested_avatar_path text := nullif(btrim(requested_preferences ->> 'avatarPath'), '');
  requested_full_name text := btrim(requested_preferences ->> 'fullName');
begin
  if current_user_id is null or target_company_id is null then
    raise exception using errcode = '42501', message = 'An active company profile is required.';
  end if;

  if requested_preferences is null or jsonb_typeof(requested_preferences) <> 'object' then
    raise exception using errcode = '22023', message = 'User preferences must be an object.';
  end if;

  if requested_full_name is null or char_length(requested_full_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Full name must contain between 2 and 120 characters.';
  end if;

  if requested_avatar_path is not null
     and requested_avatar_path <> (current_user_id::text || '/avatar') then
    raise exception using errcode = '22023', message = 'Invalid profile avatar path.';
  end if;

  update public.profiles
  set full_name = requested_full_name
  where id = current_user_id;

  update public.user_preferences
  set avatar_path = requested_avatar_path,
      theme_preference = requested_preferences ->> 'themePreference',
      table_density = requested_preferences ->> 'tableDensity',
      sidebar_preference = requested_preferences ->> 'sidebarPreference',
      notifications_enabled = (requested_preferences ->> 'notificationsEnabled')::boolean,
      membership_notifications = (requested_preferences ->> 'membershipNotifications')::boolean,
      default_landing_page = requested_preferences ->> 'defaultLandingPage',
      updated_at = now()
  where profile_id = current_user_id
  returning * into saved_preferences;

  return jsonb_build_object(
    'profileId', saved_preferences.profile_id,
    'avatarPath', saved_preferences.avatar_path,
    'themePreference', saved_preferences.theme_preference,
    'tableDensity', saved_preferences.table_density,
    'sidebarPreference', saved_preferences.sidebar_preference,
    'notificationsEnabled', saved_preferences.notifications_enabled,
    'membershipNotifications', saved_preferences.membership_notifications,
    'defaultLandingPage', saved_preferences.default_landing_page,
    'fullName', requested_full_name
  );
exception
  when check_violation or invalid_text_representation then
    raise exception using errcode = '22023', message = 'One or more personal preferences are invalid.';
end
$$;

revoke all on function public.get_app_settings() from public, anon, authenticated;
revoke all on function public.save_company_settings(jsonb) from public, anon, authenticated;
revoke all on function public.save_user_preferences(jsonb) from public, anon, authenticated;
grant execute on function public.get_app_settings() to authenticated;
grant execute on function public.save_company_settings(jsonb) to authenticated;
grant execute on function public.save_user_preferences(jsonb) to authenticated;

-- Private Storage buckets. Object names are deterministic and contain no
-- user-provided directory fragments: <company_id>/logo and <profile_id>/avatar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('company-branding', 'company-branding', false, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('profile-avatars', 'profile-avatars', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy logispro_settings_buckets_select
on storage.buckets for select to authenticated
using (id in ('company-branding', 'profile-avatars'));

create policy company_branding_select_tenant
on storage.objects for select to authenticated
using (
  bucket_id = 'company-branding'
  and name = app_private.current_company_id()::text || '/logo'
);

create policy company_branding_insert_manager
on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-branding'
  and name = app_private.current_company_id()::text || '/logo'
  and app_private.has_permission(app_private.current_company_id(), 'settings.manage')
);

create policy company_branding_update_manager
on storage.objects for update to authenticated
using (
  bucket_id = 'company-branding'
  and name = app_private.current_company_id()::text || '/logo'
  and app_private.has_permission(app_private.current_company_id(), 'settings.manage')
)
with check (
  bucket_id = 'company-branding'
  and name = app_private.current_company_id()::text || '/logo'
  and app_private.has_permission(app_private.current_company_id(), 'settings.manage')
);

create policy company_branding_delete_manager
on storage.objects for delete to authenticated
using (
  bucket_id = 'company-branding'
  and name = app_private.current_company_id()::text || '/logo'
  and app_private.has_permission(app_private.current_company_id(), 'settings.manage')
);

create policy profile_avatars_select_tenant
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-avatars'
  and (
    name = auth.uid()::text || '/avatar'
    or exists (
      select 1
      from public.profiles as profile
      where name = profile.id::text || '/avatar'
        and app_private.is_active_company_member(profile.company_id)
    )
  )
);

create policy profile_avatars_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and name = auth.uid()::text || '/avatar'
);

create policy profile_avatars_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-avatars'
  and name = auth.uid()::text || '/avatar'
)
with check (
  bucket_id = 'profile-avatars'
  and name = auth.uid()::text || '/avatar'
);

create policy profile_avatars_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and name = auth.uid()::text || '/avatar'
);

commit;

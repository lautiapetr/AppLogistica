-- Client records are visible to every active company member, but only active
-- admins may create, edit, or delete them. UI role checks are not a security
-- boundary, so these permissions must also be enforced by RLS.

begin;

drop policy if exists clients_insert_tenant on public.clients;
drop policy if exists clients_update_tenant on public.clients;
drop policy if exists clients_delete_tenant on public.clients;

create policy clients_insert_admin
on public.clients
for insert
to authenticated
with check (app_private.is_company_admin(company_id));

create policy clients_update_admin
on public.clients
for update
to authenticated
using (app_private.is_company_admin(company_id))
with check (app_private.is_company_admin(company_id));

create policy clients_delete_admin
on public.clients
for delete
to authenticated
using (app_private.is_company_admin(company_id));

commit;

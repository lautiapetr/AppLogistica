import { supabase } from '../config/supabase';
import type {
  CompanyRoleInput,
  CompanyRoleOption,
  CompanyRoleRecord,
  RolesAndPermissions,
  TeamMemberRecord,
} from '../types';

export const listCompanyRoleOptions = async (): Promise<CompanyRoleOption[]> => {
  const { data, error } = await supabase
    .from('company_roles')
    .select('id, name, is_default, is_active')
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return data.map((role) => ({
    id: role.id,
    name: role.name,
    isDefault: role.is_default,
    isActive: role.is_active,
  }));
};

export const getRolesAndPermissions = async (): Promise<RolesAndPermissions> => {
  const { data, error } = await supabase.rpc('get_roles_and_permissions', {});
  if (error) throw new Error(error.message);
  return data;
};

export const saveCompanyRole = async (
  roleId: string | null,
  input: CompanyRoleInput,
): Promise<CompanyRoleRecord> => {
  const { data, error } = await supabase.rpc('save_company_role', {
    target_role_id: roleId,
    role_name: input.name.trim(),
    role_description: input.description.trim(),
    requested_permission_keys: input.permissionKeys,
    requested_is_active: input.isActive,
  });

  if (error?.code === '23505') {
    throw new Error('Ya existe un rol con ese nombre.');
  }
  if (error?.code === '23503') {
    throw new Error('Reasigna sus empleados antes de desactivar este rol.');
  }
  if (error) throw new Error(error.message);
  return data;
};

export const assignEmployeeRole = async (
  profileId: string,
  roleId: string,
): Promise<TeamMemberRecord> => {
  const { data, error } = await supabase.rpc('assign_employee_role', {
    target_profile_id: profileId,
    target_role_id: roleId,
  });

  if (error) throw new Error(error.message);
  return data;
};

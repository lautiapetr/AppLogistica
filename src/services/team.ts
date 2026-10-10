import { supabase } from '../config/supabase';
import type { ProfileStatus, TeamMemberRecord } from '../types';

const MEMBER_FIELDS = 'id, company_id, full_name, email, role, role_id, status' as const;

export const listCompanyMembers = async (): Promise<TeamMemberRecord[]> => {
  const { data, error } = await supabase
    .from('profiles')
    .select(MEMBER_FIELDS)
    .order('full_name', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
};

export const reviewMembershipRequest = async (
  profileId: string,
  decision: 'approve' | 'reject',
): Promise<TeamMemberRecord> => {
  const { data, error } = await supabase.rpc('review_membership_request', {
    target_profile_id: profileId,
    decision,
  });

  if (error) throw new Error(error.message);
  return data;
};

export const manageEmployeeAccess = async (
  profileId: string,
  status: Extract<ProfileStatus, 'active' | 'suspended'>,
): Promise<TeamMemberRecord> => {
  const { data, error } = await supabase.rpc('manage_employee_access', {
    target_profile_id: profileId,
    requested_status: status,
  });

  if (error) throw new Error(error.message);
  return data;
};

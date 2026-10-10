import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../config/supabase';
import { loadAppSettings } from './settings';
import type { AppUser } from '../types';

export type OnboardingData =
  | {
      kind: 'company';
      companyName: string;
      fullName: string;
    }
  | {
      kind: 'employee';
      invitationCode: string;
      fullName: string;
    };

export type ProvisioningResult =
  | { kind: 'company'; joinCode: string }
  | { kind: 'employee' }
  | { kind: 'existing' };

export class OnboardingRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingRequiredError';
  }
}

const provisioningRequests = new Map<string, Promise<ProvisioningResult>>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;

  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }

  return 'Ocurrió un error inesperado. Intenta nuevamente.';
};

export const getOnboardingData = (user: User): OnboardingData | null => {
  const metadata: unknown = user.user_metadata;
  if (!isRecord(metadata)) return null;

  const kind = metadata.onboarding_type;
  const fullName = readNonEmptyString(metadata.full_name);
  if (!fullName) return null;

  if (kind === 'company') {
    const companyName = readNonEmptyString(metadata.company_name);
    return companyName ? { kind, companyName, fullName } : null;
  }

  if (kind === 'employee') {
    const invitationCode = readNonEmptyString(metadata.invitation_code);
    return invitationCode ? { kind, invitationCode, fullName } : null;
  }

  return null;
};

const profileExists = async (userId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data !== null;
};

const provisionFromMetadata = async (user: User): Promise<ProvisioningResult> => {
  if (await profileExists(user.id)) return { kind: 'existing' };

  const onboarding = getOnboardingData(user);
  if (!onboarding) {
    throw new OnboardingRequiredError(
      'Tu usuario todavía no tiene un perfil de LogisPro. Completa el registro para continuar.',
    );
  }

  if (onboarding.kind === 'company') {
    const { data, error } = await supabase.rpc('register_company', {
      company_name: onboarding.companyName,
      full_name: onboarding.fullName,
    });

    if (error) throw new OnboardingRequiredError(error.message);
    if (!data?.join_code) {
      throw new OnboardingRequiredError('Supabase no devolvió el código de invitación.');
    }

    return { kind: 'company', joinCode: data.join_code };
  }

  const { error } = await supabase.rpc('register_employee', {
    invitation_code: onboarding.invitationCode,
    full_name: onboarding.fullName,
  });

  if (error) throw new OnboardingRequiredError(error.message);
  return { kind: 'employee' };
};

export const ensureUserProfile = async (user: User): Promise<ProvisioningResult> => {
  const existingRequest = provisioningRequests.get(user.id);
  if (existingRequest) return existingRequest;

  const request = provisionFromMetadata(user);
  provisioningRequests.set(user.id, request);

  try {
    return await request;
  } finally {
    if (provisioningRequests.get(user.id) === request) {
      provisioningRequests.delete(user.id);
    }
  }
};

export const loadAppUser = async (session: Session): Promise<AppUser> => {
  let { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, company_id, full_name, email, role, role_id, status')
    .eq('id', session.user.id)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);

  if (!profile) {
    await ensureUserProfile(session.user);

    const profileResult = await supabase
      .from('profiles')
      .select('id, company_id, full_name, email, role, role_id, status')
      .eq('id', session.user.id)
      .maybeSingle();

    profile = profileResult.data;
    profileError = profileResult.error;
  }

  if (profileError) throw new Error(profileError.message);
  if (!profile) {
    throw new OnboardingRequiredError('No se pudo completar el perfil de LogisPro.');
  }

  const baseUser: AppUser = {
    id: profile.id,
    name: profile.full_name,
    email: profile.email ?? session.user.email ?? '',
    role: profile.role,
    roleId: profile.role_id ?? undefined,
    status: profile.status,
    permissions: [],
    companyId: profile.company_id,
  };

  if (profile.status !== 'active') return baseUser;

  // RLS exposes exactly one company to an active member, so no company_id
  // filter is needed or trusted on the frontend.
  const [companyResult, permissionsResult, appSettings] = await Promise.all([
    supabase.from('companies').select('name, join_code').maybeSingle(),
    supabase.rpc('get_my_permissions', {}),
    loadAppSettings(),
  ]);

  if (companyResult.error) throw new Error(companyResult.error.message);
  if (permissionsResult.error) throw new Error(permissionsResult.error.message);
  const company = companyResult.data;
  if (!company) throw new Error('No se encontró la empresa asociada al perfil.');

  return {
    ...baseUser,
    permissions: permissionsResult.data,
    companyName: appSettings.company.displayName || company.name,
    joinCode: profile.role === 'admin' ? company.join_code : undefined,
    avatarUrl: appSettings.user.avatarUrl ?? undefined,
    companySettings: appSettings.company,
    preferences: appSettings.user,
  };
};

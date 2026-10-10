import { supabase } from '../config/supabase';
import type {
  AppSettings,
  CompanySettings,
  CompanySettingsInput,
  Json,
  LegacyCompanySettingsPayload,
  UserPreferences,
  UserPreferencesInput,
} from '../types';

const toCompanySettings = (settings: LegacyCompanySettingsPayload): CompanySettings => {
  const {
    mapboxCenterLatitude,
    mapboxCenterLongitude,
    mapboxDefaultZoom,
    ...rest
  } = settings;
  return {
    ...rest,
    mapCenterLatitude: mapboxCenterLatitude,
    mapCenterLongitude: mapboxCenterLongitude,
    mapDefaultZoom: mapboxDefaultZoom,
  };
};

const toLegacyCompanySettingsPayload = (input: CompanySettingsInput): Json => {
  const { mapCenterLatitude, mapCenterLongitude, mapDefaultZoom, ...rest } = input;
  return {
    ...rest,
    mapboxCenterLatitude: mapCenterLatitude,
    mapboxCenterLongitude: mapCenterLongitude,
    mapboxDefaultZoom: mapDefaultZoom,
  } as Json;
};

const COMPANY_BRANDING_BUCKET = 'company-branding';
const PROFILE_AVATARS_BUCKET = 'profile-avatars';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const SIGNED_ASSET_URL_LIFETIME_SECONDS = 24 * 60 * 60;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const getSignedAssetUrl = async (
  bucket: string,
  path: string | null,
): Promise<string | null> => {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_ASSET_URL_LIFETIME_SECONDS);
  return error ? null : data.signedUrl;
};

const validateImage = (file: File): void => {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Usa una imagen PNG, JPG o WebP.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('La imagen no puede superar los 2 MB.');
  }
};

export const loadAppSettings = async (): Promise<AppSettings> => {
  const { data, error } = await supabase.rpc('get_app_settings', {});
  if (error) throw new Error(error.message);

  const [logoUrl, avatarUrl] = await Promise.all([
    getSignedAssetUrl(COMPANY_BRANDING_BUCKET, data.company.logoPath),
    getSignedAssetUrl(PROFILE_AVATARS_BUCKET, data.user.avatarPath),
  ]);

  return {
    company: { ...toCompanySettings(data.company), logoUrl },
    user: { ...data.user, avatarUrl },
  };
};

export const saveCompanySettings = async (
  input: CompanySettingsInput,
): Promise<CompanySettings> => {
  const { data, error } = await supabase.rpc('save_company_settings', {
    requested_settings: toLegacyCompanySettingsPayload(input),
  });
  if (error) throw new Error(error.message);

  return {
    ...toCompanySettings(data),
    logoUrl: await getSignedAssetUrl(COMPANY_BRANDING_BUCKET, data.logoPath),
  };
};

export const saveUserPreferences = async (
  input: UserPreferencesInput,
): Promise<UserPreferences & { fullName: string }> => {
  const { data, error } = await supabase.rpc('save_user_preferences', {
    requested_preferences: input as unknown as Json,
  });
  if (error) throw new Error(error.message);

  return {
    ...data,
    avatarUrl: await getSignedAssetUrl(PROFILE_AVATARS_BUCKET, data.avatarPath),
  };
};

const uploadImage = async (bucket: string, path: string, file: File): Promise<string> => {
  validateImage(file);
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: '3600',
  });
  if (error) throw new Error(error.message);
  return path;
};

export const uploadCompanyLogo = (companyId: string, file: File): Promise<string> => (
  uploadImage(COMPANY_BRANDING_BUCKET, `${companyId}/logo`, file)
);

export const uploadProfileAvatar = (profileId: string, file: File): Promise<string> => (
  uploadImage(PROFILE_AVATARS_BUCKET, `${profileId}/avatar`, file)
);

export const removeCompanyLogo = async (path: string): Promise<void> => {
  const { error } = await supabase.storage.from(COMPANY_BRANDING_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
};

export const removeProfileAvatar = async (path: string): Promise<void> => {
  const { error } = await supabase.storage.from(PROFILE_AVATARS_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
};

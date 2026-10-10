import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Building2,
  Check,
  ImagePlus,
  MapPin,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  UserRound,
} from 'lucide-react';
import { getErrorMessage } from '../services/auth';
import {
  removeCompanyLogo,
  removeProfileAvatar,
  saveCompanySettings,
  saveUserPreferences,
  uploadCompanyLogo,
  uploadProfileAvatar,
} from '../services/settings';
import type {
  AppUser,
  CompanySettings,
  CompanySettingsInput,
  RouteType,
  UserPreferences,
  UserPreferencesInput,
} from '../types';

const VISUAL_DEFAULTS = {
  primaryColor: '#5600FF',
  accentColor: '#8B3DFF',
  defaultTheme: 'light' as const,
  tableDensity: 'comfortable' as const,
  sidebarDefaultCollapsed: false,
};

const TIMEZONES = [
  ['America/Argentina/Buenos_Aires', 'Buenos Aires'],
  ['America/Argentina/Cordoba', 'Córdoba'],
  ['America/Argentina/Mendoza', 'Mendoza'],
  ['America/Argentina/Salta', 'Salta'],
  ['America/Argentina/Ushuaia', 'Ushuaia'],
] as const;

const ROUTE_LABELS: Record<RouteType, string> = {
  movements: 'Movimientos',
  statistics: 'Estadísticas',
  clients: 'Clientes',
  zones: 'Zonas',
  team: 'Equipo',
  roles: 'Roles y permisos',
  pricing: 'Valores económicos',
  settings: 'Configuración',
};

const toCompanyInput = (settings: CompanySettings): CompanySettingsInput => ({
  displayName: settings.displayName,
  logoPath: settings.logoPath,
  contactEmail: settings.contactEmail,
  contactPhone: settings.contactPhone,
  address: settings.address,
  timezone: settings.timezone,
  locale: settings.locale,
  currency: settings.currency,
  dateFormat: settings.dateFormat,
  mapCenterLatitude: settings.mapCenterLatitude,
  mapCenterLongitude: settings.mapCenterLongitude,
  mapDefaultZoom: settings.mapDefaultZoom,
  primaryColor: settings.primaryColor,
  accentColor: settings.accentColor,
  defaultTheme: settings.defaultTheme,
  tableDensity: settings.tableDensity,
  sidebarDefaultCollapsed: settings.sidebarDefaultCollapsed,
});

const toUserInput = (user: AppUser, preferences: UserPreferences): UserPreferencesInput => ({
  fullName: user.name,
  avatarPath: preferences.avatarPath,
  themePreference: preferences.themePreference,
  tableDensity: preferences.tableDensity,
  sidebarPreference: preferences.sidebarPreference,
  notificationsEnabled: preferences.notificationsEnabled,
  membershipNotifications: preferences.membershipNotifications,
  defaultLandingPage: preferences.defaultLandingPage,
});

interface SettingsPageProps {
  user: AppUser;
  canManageCompany: boolean;
  availableRoutes: RouteType[];
  onPreview: (company: CompanySettingsInput, user: UserPreferencesInput) => void;
  onSaved: (
    company: CompanySettings | null,
    preferences: (UserPreferences & { fullName?: string }) | null,
  ) => void;
}

export const SettingsPage = ({
  user,
  canManageCompany,
  availableRoutes,
  onPreview,
  onSaved,
}: SettingsPageProps) => {
  const companySettings = user.companySettings!;
  const userPreferences = user.preferences!;

  const [companyDraft, setCompanyDraft] = useState<CompanySettingsInput>(
    () => toCompanyInput(companySettings),
  );
  const [companyBaseline, setCompanyBaseline] = useState<CompanySettingsInput>(
    () => toCompanyInput(companySettings),
  );
  const [userDraft, setUserDraft] = useState<UserPreferencesInput>(
    () => toUserInput(user, userPreferences),
  );
  const [userBaseline, setUserBaseline] = useState<UserPreferencesInput>(
    () => toUserInput(user, userPreferences),
  );
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const localLogoUrl = useMemo(() => logoFile ? URL.createObjectURL(logoFile) : null, [logoFile]);
  const localAvatarUrl = useMemo(() => avatarFile ? URL.createObjectURL(avatarFile) : null, [avatarFile]);
  useEffect(() => () => { if (localLogoUrl) URL.revokeObjectURL(localLogoUrl); }, [localLogoUrl]);
  useEffect(() => () => { if (localAvatarUrl) URL.revokeObjectURL(localAvatarUrl); }, [localAvatarUrl]);

  const companyChanged = canManageCompany && (
    JSON.stringify(companyDraft) !== JSON.stringify(companyBaseline)
    || logoFile !== null
    || removeLogo
  );
  const userChanged = JSON.stringify(userDraft) !== JSON.stringify(userBaseline)
    || avatarFile !== null
    || removeAvatar;
  const hasPendingChanges = companyChanged || userChanged;
  const isSaving = isSavingCompany || isSavingUser;

  const updateCompany = (patch: Partial<CompanySettingsInput>) => {
    const next = { ...companyDraft, ...patch };
    setNotice(null);
    setCompanyError(null);
    setCompanyDraft(next);
    onPreview(next, userDraft);
  };

  const updateUser = (patch: Partial<UserPreferencesInput>) => {
    const next = { ...userDraft, ...patch };
    setNotice(null);
    setUserError(null);
    setUserDraft(next);
    onPreview(companyDraft, next);
  };

  const resetVisuals = () => updateCompany(VISUAL_DEFAULTS);

  const persistCompanyChanges = async (): Promise<void> => {
    let logoPath = companyDraft.logoPath;
    if (logoFile) {
      logoPath = await uploadCompanyLogo(user.companyId!, logoFile);
    } else if (removeLogo && logoPath) {
      await removeCompanyLogo(logoPath);
      logoPath = null;
    }

    const saved = await saveCompanySettings({ ...companyDraft, logoPath });
    const savedInput = toCompanyInput(saved);
    setCompanyDraft(savedInput);
    setCompanyBaseline(savedInput);
    setLogoFile(null);
    setRemoveLogo(false);
    onSaved(saved, null);
  };

  const persistUserChanges = async (): Promise<void> => {
    let avatarPath = userDraft.avatarPath;
    if (avatarFile) {
      avatarPath = await uploadProfileAvatar(user.id, avatarFile);
    } else if (removeAvatar && avatarPath) {
      await removeProfileAvatar(avatarPath);
      avatarPath = null;
    }

    const saved = await saveUserPreferences({ ...userDraft, avatarPath });
    const savedInput = { ...userDraft, avatarPath, fullName: saved.fullName };
    setUserDraft(savedInput);
    setUserBaseline(savedInput);
    setAvatarFile(null);
    setRemoveAvatar(false);
    onSaved(null, saved);
  };

  const saveAllChanges = async () => {
    const shouldSaveCompany = companyChanged;
    const shouldSaveUser = userChanged;
    let failedSections = 0;

    setNotice(null);
    setCompanyError(null);
    setUserError(null);

    if (shouldSaveCompany) {
      setIsSavingCompany(true);
      try {
        await persistCompanyChanges();
      } catch (caughtError: unknown) {
        failedSections += 1;
        setCompanyError(getErrorMessage(caughtError));
      } finally {
        setIsSavingCompany(false);
      }
    }

    if (shouldSaveUser) {
      setIsSavingUser(true);
      try {
        await persistUserChanges();
      } catch (caughtError: unknown) {
        failedSections += 1;
        setUserError(getErrorMessage(caughtError));
      } finally {
        setIsSavingUser(false);
      }
    }

    if (failedSections === 0) {
      setNotice('Todos los cambios se guardaron correctamente.');
    }
  };

  const logoPreview = removeLogo ? null : (localLogoUrl ?? companySettings.logoUrl ?? null);
  const avatarPreview = removeAvatar ? null : (localAvatarUrl ?? userPreferences.avatarUrl ?? null);

  return (
    <div className={`animate-in space-y-6 ${hasPendingChanges ? 'pb-24' : ''}`}>
      <div><h1 className="text-2xl font-bold text-slate-900">Configuración</h1><p className="mt-1 text-slate-500">Personaliza la operación, identidad visual y tu experiencia en LogisPro.</p></div>

      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><Check size={17} /> {notice}</div>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-[var(--color-primary)]"><Building2 size={20} /></div><div><h2 className="font-bold text-slate-900">Empresa y operación</h2><p className="text-sm text-slate-500">Datos compartidos y valores predeterminados.</p></div></div>
        {!canManageCompany && <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">Tu rol permite consultar esta información, pero no modificarla.</div>}
        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">Nombre visible<input disabled={!canManageCompany} required value={companyDraft.displayName} onChange={(event) => updateCompany({ displayName: event.target.value })} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[var(--color-primary)] disabled:bg-slate-50" /></label>
          <label className="text-sm font-medium text-slate-700">Correo de contacto<input disabled={!canManageCompany} type="email" value={companyDraft.contactEmail ?? ''} onChange={(event) => updateCompany({ contactEmail: event.target.value || null })} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[var(--color-primary)] disabled:bg-slate-50" /></label>
          <label className="text-sm font-medium text-slate-700">Teléfono<input disabled={!canManageCompany} value={companyDraft.contactPhone ?? ''} onChange={(event) => updateCompany({ contactPhone: event.target.value || null })} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[var(--color-primary)] disabled:bg-slate-50" /></label>
          <label className="text-sm font-medium text-slate-700 md:col-span-2 lg:col-span-3">Dirección<input disabled={!canManageCompany} value={companyDraft.address ?? ''} onChange={(event) => updateCompany({ address: event.target.value || null })} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[var(--color-primary)] disabled:bg-slate-50" /></label>
          <label className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 shadow-sm">
            Zona horaria
            <span className="mt-1 block min-h-8 text-xs font-normal leading-4 text-[var(--color-text-muted)] opacity-75">Define la hora usada en avisos y futuras operaciones programadas.</span>
            <select disabled={!canManageCompany} value={companyDraft.timezone} onChange={(event) => updateCompany({ timezone: event.target.value })} className="mt-2 block w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 font-medium outline-none focus:border-[var(--color-primary)] disabled:bg-slate-100">{TIMEZONES.map(([value, label]) => <option key={value} value={value}>{label} — Argentina</option>)}</select>
          </label>
          <label className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 shadow-sm">
            Región para formatos
            <span className="mt-1 block min-h-8 text-xs font-normal leading-4 text-[var(--color-text-muted)] opacity-75">Cambia cómo se muestran números, fechas y horas; no traduce la interfaz.</span>
            <select disabled={!canManageCompany} value={companyDraft.locale} onChange={(event) => updateCompany({ locale: event.target.value as CompanySettingsInput['locale'] })} className="mt-2 block w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 font-medium outline-none focus:border-[var(--color-primary)] disabled:bg-slate-100"><option value="es-AR">Argentina — Español (1.234,56)</option><option value="en-US">Estados Unidos — English (1,234.56)</option><option value="pt-BR">Brasil — Português (1.234,56)</option></select>
          </label>
          <label className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 shadow-sm">
            Moneda principal
            <span className="mt-1 block min-h-8 text-xs font-normal leading-4 text-[var(--color-text-muted)] opacity-75">Será la moneda sugerida para tarifas y valores económicos.</span>
            <select disabled={!canManageCompany} value={companyDraft.currency} onChange={(event) => updateCompany({ currency: event.target.value as CompanySettingsInput['currency'] })} className="mt-2 block w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 font-medium outline-none focus:border-[var(--color-primary)] disabled:bg-slate-100"><option value="ARS">ARS — Peso argentino</option><option value="USD">USD — Dólar estadounidense</option><option value="EUR">EUR — Euro</option><option value="BRL">BRL — Real brasileño</option></select>
          </label>
          <label className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 shadow-sm">
            Formato de fecha
            <span className="mt-1 block min-h-8 text-xs font-normal leading-4 text-[var(--color-text-muted)] opacity-75">Ejemplo con el 26 de agosto de 2026.</span>
            <select disabled={!canManageCompany} value={companyDraft.dateFormat} onChange={(event) => updateCompany({ dateFormat: event.target.value as CompanySettingsInput['dateFormat'] })} className="mt-2 block w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 font-medium outline-none focus:border-[var(--color-primary)] disabled:bg-slate-100"><option value="DD/MM/YYYY">26/08/2026 — Día/Mes/Año</option><option value="MM/DD/YYYY">08/26/2026 — Mes/Día/Año</option><option value="YYYY-MM-DD">2026-08-26 — Año-Mes-Día</option></select>
          </label>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-5"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><MapPin size={17} /> Centro predeterminado del mapa</h3><div className="mt-3 grid gap-4 sm:grid-cols-3"><label className="text-sm text-slate-600">Latitud<input disabled={!canManageCompany} type="number" step="0.0001" min={-90} max={90} value={companyDraft.mapCenterLatitude} onChange={(event) => updateCompany({ mapCenterLatitude: Number(event.target.value) })} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label><label className="text-sm text-slate-600">Longitud<input disabled={!canManageCompany} type="number" step="0.0001" min={-180} max={180} value={companyDraft.mapCenterLongitude} onChange={(event) => updateCompany({ mapCenterLongitude: Number(event.target.value) })} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label><label className="text-sm text-slate-600">Zoom<input disabled={!canManageCompany} type="number" step="0.5" min={1} max={20} value={companyDraft.mapDefaultZoom} onChange={(event) => updateCompany({ mapDefaultZoom: Number(event.target.value) })} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label></div></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-[var(--color-primary)]"><Palette size={20} /></div><div><h2 className="font-bold text-slate-900">Identidad y apariencia</h2><p className="text-sm text-slate-500">Los cambios visuales se previsualizan antes de guardar.</p></div></div>{canManageCompany && <button type="button" onClick={resetVisuals} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><RotateCcw size={15} /> Restaurar visuales</button>}</div>
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <div className="space-y-4">
            <div><p className="text-sm font-medium text-slate-700">Logo de empresa</p><div className="mt-2 flex items-center gap-3">{logoPreview ? <img src={logoPreview} alt="Logo de empresa" className="h-16 w-16 rounded-xl border border-slate-200 bg-white object-contain p-1" /> : <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><Building2 /></div>}{canManageCompany && <div className="flex flex-wrap gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600"><ImagePlus size={15} /> Elegir<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { setNotice(null); setCompanyError(null); setLogoFile(event.target.files?.[0] ?? null); setRemoveLogo(false); }} /></label>{(logoPreview || companyDraft.logoPath) && <button type="button" onClick={() => { setNotice(null); setCompanyError(null); setLogoFile(null); setRemoveLogo(true); }} className="rounded-lg p-2 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>}</div>}</div></div>
            <label className="block text-sm font-medium text-slate-700">Color principal<div className="mt-1.5 flex gap-2"><input disabled={!canManageCompany} type="color" value={companyDraft.primaryColor} onChange={(event) => updateCompany({ primaryColor: event.target.value.toUpperCase() })} className="h-11 w-14 rounded-lg border border-slate-200 bg-white p-1" /><input disabled={!canManageCompany} value={companyDraft.primaryColor} onChange={(event) => updateCompany({ primaryColor: event.target.value.toUpperCase() })} pattern="#[0-9A-Fa-f]{6}" className="w-full rounded-xl border border-slate-200 px-3" /></div></label>
            <label className="block text-sm font-medium text-slate-700">Color de acento<div className="mt-1.5 flex gap-2"><input disabled={!canManageCompany} type="color" value={companyDraft.accentColor} onChange={(event) => updateCompany({ accentColor: event.target.value.toUpperCase() })} className="h-11 w-14 rounded-lg border border-slate-200 bg-white p-1" /><input disabled={!canManageCompany} value={companyDraft.accentColor} onChange={(event) => updateCompany({ accentColor: event.target.value.toUpperCase() })} pattern="#[0-9A-Fa-f]{6}" className="w-full rounded-xl border border-slate-200 px-3" /></div></label>
          </div>
          <div className="space-y-4"><label className="block text-sm font-medium text-slate-700">Tema predeterminado<select disabled={!canManageCompany} value={companyDraft.defaultTheme} onChange={(event) => updateCompany({ defaultTheme: event.target.value as CompanySettingsInput['defaultTheme'] })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="light">Claro</option><option value="dark">Oscuro</option><option value="system">Seguir al sistema</option></select></label><label className="block text-sm font-medium text-slate-700">Densidad predeterminada<select disabled={!canManageCompany} value={companyDraft.tableDensity} onChange={(event) => updateCompany({ tableDensity: event.target.value as CompanySettingsInput['tableDensity'] })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="comfortable">Cómoda</option><option value="compact">Compacta</option></select></label><label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-700"><input disabled={!canManageCompany} type="checkbox" checked={companyDraft.sidebarDefaultCollapsed} onChange={(event) => updateCompany({ sidebarDefaultCollapsed: event.target.checked })} className="h-4 w-4 accent-[var(--color-primary)]" /> Barra lateral contraída por defecto</label></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Vista previa</p><div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="h-3" style={{ background: `linear-gradient(90deg, ${companyDraft.primaryColor}, ${companyDraft.accentColor})` }} /><div className="p-4"><div className="flex items-center gap-3">{logoPreview ? <img src={logoPreview} className="h-9 w-9 rounded-lg object-contain" alt="" /> : <div className="h-9 w-9 rounded-lg" style={{ backgroundColor: companyDraft.primaryColor }} />}<div><p className="font-bold text-slate-900">{companyDraft.displayName || 'Tu empresa'}</p><p className="text-xs text-slate-500">Identidad compartida</p></div></div><button type="button" className="mt-4 w-full rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ backgroundColor: companyDraft.primaryColor }}>Acción principal</button></div></div></div>
        </div>
        {companyError && <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={17} /> {companyError}</div>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><UserRound size={20} /></div><div><h2 className="font-bold text-slate-900">Preferencias personales</h2><p className="text-sm text-slate-500">Sólo afectan a tu cuenta.</p></div></div>
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <div><p className="text-sm font-medium text-slate-700">Avatar</p><div className="mt-2 flex items-center gap-3">{avatarPreview ? <img src={avatarPreview} alt="Avatar" className="h-16 w-16 rounded-xl object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--color-primary)] text-xl font-bold text-white">{userDraft.fullName.charAt(0).toUpperCase()}</div>}<div className="flex gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600"><ImagePlus size={15} /> Elegir<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { setNotice(null); setUserError(null); setAvatarFile(event.target.files?.[0] ?? null); setRemoveAvatar(false); }} /></label>{(avatarPreview || userDraft.avatarPath) && <button type="button" onClick={() => { setNotice(null); setUserError(null); setAvatarFile(null); setRemoveAvatar(true); }} className="rounded-lg p-2 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>}</div></div><label className="mt-4 block text-sm font-medium text-slate-700">Nombre completo<input value={userDraft.fullName} minLength={2} maxLength={120} onChange={(event) => updateUser({ fullName: event.target.value })} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label></div>
          <div className="space-y-4"><label className="block text-sm font-medium text-slate-700">Tema personal<select value={userDraft.themePreference} onChange={(event) => updateUser({ themePreference: event.target.value as UserPreferencesInput['themePreference'] })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="company">Usar el de la empresa</option><option value="light">Claro</option><option value="dark">Oscuro</option><option value="system">Seguir al sistema</option></select></label><label className="block text-sm font-medium text-slate-700">Densidad<select value={userDraft.tableDensity} onChange={(event) => updateUser({ tableDensity: event.target.value as UserPreferencesInput['tableDensity'] })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="company">Usar la de la empresa</option><option value="comfortable">Cómoda</option><option value="compact">Compacta</option></select></label><label className="block text-sm font-medium text-slate-700">Barra lateral<select value={userDraft.sidebarPreference} onChange={(event) => updateUser({ sidebarPreference: event.target.value as UserPreferencesInput['sidebarPreference'] })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="company">Usar preferencia de empresa</option><option value="expanded">Expandida</option><option value="collapsed">Contraída</option></select></label><label className="block text-sm font-medium text-slate-700">Página inicial<select value={userDraft.defaultLandingPage} onChange={(event) => updateUser({ defaultLandingPage: event.target.value as RouteType })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5">{availableRoutes.map((route) => <option key={route} value={route}>{ROUTE_LABELS[route]}</option>)}</select></label></div>
          <div><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Bell size={17} /> Notificaciones</h3><div className="mt-3 space-y-3"><label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700"><span>Notificaciones dentro de la web</span><input type="checkbox" checked={userDraft.notificationsEnabled} onChange={(event) => updateUser({ notificationsEnabled: event.target.checked })} className="h-4 w-4 accent-[var(--color-primary)]" /></label><label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700"><span>Solicitudes y decisiones de equipo</span><input type="checkbox" checked={userDraft.membershipNotifications} onChange={(event) => updateUser({ membershipNotifications: event.target.checked })} className="h-4 w-4 accent-[var(--color-primary)]" /></label><div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500"><Settings2 size={16} className="mb-2" />Estas preferencias controlan la presentación en la web. Los avisos críticos de seguridad no se desactivan.</div></div></div>
        </div>
        {userError && <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={17} /> {userError}</div>}
      </section>

      {hasPendingChanges && (
        <div className="fixed inset-x-4 bottom-5 z-40 mx-auto flex max-w-xl items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-2xl md:px-4">
          <div className="min-w-0">
            <p className="font-semibold text-[var(--color-text-main)]">Tienes cambios sin guardar</p>
            <p className="truncate text-xs text-[var(--color-text-muted)]">
              {companyChanged && userChanged
                ? 'Se actualizarán la empresa y tus preferencias.'
                : companyChanged
                  ? 'Se actualizará la configuración de la empresa.'
                  : 'Se actualizarán tus preferencias personales.'}
            </p>
          </div>
          <button type="button" disabled={isSaving} onClick={() => void saveAllChanges()} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-[var(--color-primary-hover)] disabled:cursor-wait disabled:opacity-60">
            {isSaving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            {isSaving ? 'Guardando...' : 'Guardar todo'}
          </button>
        </div>
      )}
    </div>
  );
};

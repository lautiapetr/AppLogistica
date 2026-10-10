import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './config/supabase';
import { loadAppUser, getErrorMessage, OnboardingRequiredError } from './services/auth';
import type {
  AppUser,
  CompanySettings,
  CompanySettingsInput,
  PermissionKey,
  RouteType,
  StatisticsFilters,
  TableDensity,
  ThemeMode,
  UserPreferences,
  UserPreferencesInput,
} from './types';
import { AuthPage } from './pages/Auth';
import {
  AccessErrorPage,
  AccountSetupPage,
  RestrictedAccountPage,
} from './pages/AccountStatus';
import { MovementsPage } from './pages/Movements';
import { StatisticsPage } from './pages/Statistics';
import { ClientsPage } from './pages/Clients';
import { ZonesPage } from './pages/Zones';
import { TeamPage } from './pages/Team';
import { RolesPage } from './pages/Roles';
import { SettingsPage } from './pages/Settings';
import { PricingPage } from './pages/Pricing';
import { Topbar } from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';

type AccessState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'setup'; session: Session; message: string }
  | { kind: 'restricted'; session: Session; user: AppUser }
  | { kind: 'active'; session: Session; user: AppUser }
  | { kind: 'error'; session: Session; message: string };

const ROUTE_PERMISSIONS: Record<RouteType, PermissionKey> = {
  movements: 'shipments.view',
  statistics: 'statistics.view',
  clients: 'clients.view',
  zones: 'zones.view',
  team: 'members.view',
  roles: 'members.manage_roles',
  pricing: 'pricing.view',
  settings: 'settings.view',
};

const darkenHex = (hex: string): string => {
  const value = hex.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(value)) return '#4400CC';
  const channels = [0, 2, 4].map((offset) => (
    Math.max(0, Math.round(Number.parseInt(value.slice(offset, offset + 2), 16) * 0.8))
      .toString(16)
      .padStart(2, '0')
  ));
  return `#${channels.join('')}`.toUpperCase();
};

export default function App() {
  const [access, setAccess] = useState<AccessState>({ kind: 'loading' });
  const requestId = useRef(0);
  const [sidebarOpenOverride, setSidebarOpenOverride] = useState<boolean | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<RouteType | null>(null);
  const [movementFilters, setMovementFilters] = useState<StatisticsFilters | null>(null);
  const [visualPreview, setVisualPreview] = useState<{
    company: CompanySettingsInput;
    user: UserPreferencesInput;
  } | null>(null);

  const loadAccess = useCallback(async (session: Session | null) => {
    const currentRequestId = ++requestId.current;

    if (!session) {
      setAccess({ kind: 'signed-out' });
      return;
    }

    setAccess({ kind: 'loading' });

    try {
      const user = await loadAppUser(session);
      if (currentRequestId !== requestId.current) return;

      setAccess(
        user.status === 'active'
          ? { kind: 'active', session, user }
          : { kind: 'restricted', session, user },
      );
    } catch (caughtError: unknown) {
      if (currentRequestId !== requestId.current) return;

      const message = getErrorMessage(caughtError);
      setAccess(
        caughtError instanceof OnboardingRequiredError
          ? { kind: 'setup', session, message }
          : { kind: 'error', session, message },
      );
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;

      if (error) {
        setAccess({ kind: 'signed-out' });
        return;
      }

      void loadAccess(data.session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Run Supabase queries after the auth callback releases its internal lock.
      queueMicrotask(() => {
        if (isMounted) void loadAccess(session);
      });
    });

    return () => {
      isMounted = false;
      requestId.current += 1;
      subscription.unsubscribe();
    };
  }, [loadAccess]);

  useEffect(() => {
    if (access.kind !== 'active' && access.kind !== 'restricted') return undefined;

    const { session, user } = access;
    const channel = supabase
      .channel(`access-profile-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        () => void loadAccess(session),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [access, loadAccess]);

  const activeUser = access.kind === 'active' ? access.user : null;
  const visualCompany = visualPreview?.company ?? activeUser?.companySettings;
  const visualUser = visualPreview?.user ?? activeUser?.preferences;
  const effectiveTheme: ThemeMode = visualUser?.themePreference === 'company'
    ? (visualCompany?.defaultTheme ?? 'light')
    : (visualUser?.themePreference ?? 'light');
  const effectiveDensity: TableDensity = visualUser?.tableDensity === 'company'
    ? (visualCompany?.tableDensity ?? 'comfortable')
    : (visualUser?.tableDensity ?? 'comfortable');

  useEffect(() => {
    const root = document.documentElement;
    const primaryColor = visualCompany?.primaryColor ?? '#5600FF';
    root.style.setProperty('--color-primary', primaryColor);
    root.style.setProperty('--color-primary-hover', darkenHex(primaryColor));
    root.style.setProperty('--color-accent', visualCompany?.accentColor ?? '#8B3DFF');
    root.dataset.theme = effectiveTheme;
    root.dataset.density = effectiveDensity;
  }, [effectiveDensity, effectiveTheme, visualCompany?.accentColor, visualCompany?.primaryColor]);

  if (access.kind === 'loading') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin w-8 h-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (access.kind === 'signed-out') return <AuthPage />;

  if (access.kind === 'setup') {
    return (
      <AccountSetupPage
        session={access.session}
        initialError={access.message}
        onCompleted={() => loadAccess(access.session)}
      />
    );
  }

  if (access.kind === 'restricted') {
    return (
      <RestrictedAccountPage
        user={access.user}
        onRefresh={() => loadAccess(access.session)}
      />
    );
  }

  if (access.kind === 'error') {
    return (
      <AccessErrorPage
        message={access.message}
        onRetry={() => loadAccess(access.session)}
      />
    );
  }

  // Administrators are system owners and the database grants them every
  // permission. Keeping that invariant here prevents newly added modules from
  // disappearing until a previously loaded permission list is refreshed.
  const hasPermission = (permission: PermissionKey) => (
    access.user.role === 'admin' || access.user.permissions.includes(permission)
  );
  const navigationPermissions: PermissionKey[] = access.user.role === 'admin'
    ? Array.from(new Set<PermissionKey>([
      ...access.user.permissions,
      ...Object.values(ROUTE_PERMISSIONS),
    ]))
    : access.user.permissions;
  const availableRoutes = (Object.keys(ROUTE_PERMISSIONS) as RouteType[])
    .filter((route) => hasPermission(ROUTE_PERMISSIONS[route]));
  const preferredRoute = access.user.preferences?.defaultLandingPage ?? 'movements';
  const requestedRoute = currentRoute ?? preferredRoute;
  const activeRoute = availableRoutes.includes(requestedRoute)
    ? requestedRoute
    : availableRoutes[0];
  const companySidebarCollapsed = visualCompany?.sidebarDefaultCollapsed ?? false;
  const preferredSidebarCollapsed = visualUser?.sidebarPreference === 'company'
    ? companySidebarCollapsed
    : visualUser?.sidebarPreference === 'collapsed';
  const isSidebarOpen = sidebarOpenOverride ?? !preferredSidebarCollapsed;

  const changeRoute = (route: RouteType) => {
    if (!hasPermission(ROUTE_PERMISSIONS[route])) return;
    if (route !== 'settings') setVisualPreview(null);
    if (route === 'movements') setMovementFilters(null);
    setCurrentRoute(route);
  };

  const openFilteredMovements = (filters: StatisticsFilters) => {
    setMovementFilters(filters);
    setCurrentRoute('movements');
  };

  const saveSettingsInSession = (
    company: CompanySettings | null,
    preferences: (UserPreferences & { fullName?: string }) | null,
  ) => {
    setAccess((current) => {
      if (current.kind !== 'active') return current;
      const nextCompany = company ?? current.user.companySettings;
      const nextPreferences = preferences ?? current.user.preferences;
      return {
        ...current,
        user: {
          ...current.user,
          name: preferences?.fullName ?? current.user.name,
          companyName: company?.displayName ?? current.user.companyName,
          avatarUrl: preferences?.avatarUrl ?? current.user.avatarUrl,
          companySettings: nextCompany,
          preferences: nextPreferences,
        },
      };
    });
    setVisualPreview(null);
    setSidebarOpenOverride(null);
  };

  const renderView = () => {
    if (!activeRoute) {
      return (
        <div className="rounded-2xl border border-amber-100 bg-white p-10 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Sin módulos asignados</h1>
          <p className="mt-2 text-sm text-slate-500">Pide a un administrador que revise los permisos de tu rol.</p>
        </div>
      );
    }

    switch (activeRoute) {
      case 'movements': return (
        <MovementsPage
          key={movementFilters ? Object.values(movementFilters).join('|') : 'all-movements'}
          initialFilters={movementFilters ?? undefined}
          canCreate={hasPermission('shipments.create')}
          canUpdate={hasPermission('shipments.update')}
          canDelete={hasPermission('shipments.delete')}
          canViewPricing={hasPermission('pricing.view')}
          canManagePricing={hasPermission('pricing.manage')}
        />
      );
      case 'statistics': return (
        <StatisticsPage
          canExport={hasPermission('statistics.export')}
          canViewPricing={hasPermission('pricing.view')}
          onOpenMovements={openFilteredMovements}
        />
      );
      case 'clients': return <ClientsPage canManage={hasPermission('clients.manage')} />;
      case 'zones': return (
        <ZonesPage
          canManage={hasPermission('zones.manage')}
          mapDefaults={{
            latitude: access.user.companySettings?.mapCenterLatitude ?? -34.6037,
            longitude: access.user.companySettings?.mapCenterLongitude ?? -58.3816,
            zoom: access.user.companySettings?.mapDefaultZoom ?? 9.5,
          }}
        />
      );
      case 'team': return <TeamPage canReview={hasPermission('members.review')} canManageRoles={hasPermission('members.manage_roles')} />;
      case 'roles': return <RolesPage />;
      case 'pricing': return (
        <PricingPage
          canManage={hasPermission('pricing.manage')}
          locale={access.user.companySettings?.locale ?? 'es-AR'}
        />
      );
      case 'settings': return (
        <SettingsPage
          user={access.user}
          canManageCompany={hasPermission('settings.manage')}
          availableRoutes={availableRoutes}
          onPreview={(company, user) => setVisualPreview({ company, user })}
          onSaved={saveSettingsInSession}
        />
      );
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900 selection:bg-[var(--color-primary)]/20 selection:text-[var(--color-primary)]">
      <Sidebar
        isOpen={isSidebarOpen}
        isMobileOpen={isMobileSidebarOpen}
        onMobileClose={() => setIsMobileSidebarOpen(false)}
        currentRoute={activeRoute ?? 'settings'}
        onRouteChange={changeRoute}
        permissions={navigationPermissions}
        brandLogoUrl={access.user.companySettings?.logoUrl}
      />
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Topbar
          user={{
            ...access.user,
            companyName: visualCompany?.displayName ?? access.user.companyName,
          }}
          onRouteChange={changeRoute}
          onMenuToggle={() => (
            window.innerWidth >= 1024
              ? setSidebarOpenOverride(!isSidebarOpen)
              : setIsMobileSidebarOpen(true)
          )}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 scroll-smooth">
          <div className="max-w-7xl mx-auto pb-12 h-full">
            {renderView()}
          </div>
        </main>
      </div>
    </div>
  );
}

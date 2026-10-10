import { Package, BarChart3, Users, UserCog, X, Settings, Map as MapIcon, ShieldCheck, CircleDollarSign } from 'lucide-react';
import type { PermissionKey, RouteType, NavItem } from '../../types';

interface SidebarProps {
  isOpen: boolean;
  isMobileOpen: boolean;
  onMobileClose: () => void;
  currentRoute: RouteType;
  onRouteChange: (route: RouteType) => void;
  permissions: PermissionKey[];
  brandLogoUrl?: string | null;
}

type SidebarContentProps = Pick<
  SidebarProps,
  'isOpen' | 'onMobileClose' | 'currentRoute' | 'onRouteChange' | 'permissions' | 'brandLogoUrl'
>;

const NAV_ITEMS: NavItem[] = [
  { id: 'movements', label: 'Movimientos Diarios', icon: Package, permission: 'shipments.view' },
  { id: 'zones', label: 'Zonas y Rutas', icon: MapIcon, permission: 'zones.view' },
  { id: 'statistics', label: 'Estadísticas', icon: BarChart3, permission: 'statistics.view' },
  { id: 'clients', label: 'Gestión de Clientes', icon: Users, permission: 'clients.view' },
  { id: 'team', label: 'Equipo', icon: UserCog, permission: 'members.view' },
  { id: 'roles', label: 'Roles y Permisos', icon: ShieldCheck, permission: 'members.manage_roles' },
  { id: 'pricing', label: 'Valores Económicos', icon: CircleDollarSign, permission: 'pricing.view' },
  { id: 'settings', label: 'Configuración', icon: Settings, permission: 'settings.view' },
];

const SidebarContent = ({ isOpen, onMobileClose, currentRoute, onRouteChange, permissions, brandLogoUrl }: SidebarContentProps) => (
    <>
      <div className="h-16 flex items-center px-6 border-b border-slate-200 justify-between">
        <div className="flex items-center gap-3 overflow-hidden whitespace-nowrap">
          {brandLogoUrl ? <img src={brandLogoUrl} alt="" className="h-8 w-8 shrink-0 rounded object-contain" /> : <div className="w-8 h-8 rounded bg-[var(--color-primary)] flex items-center justify-center shrink-0 shadow-sm shadow-[var(--color-primary)]/30"><Package size={20} className="text-white" /></div>}
          <span className={`font-bold text-xl text-slate-900 transition-opacity duration-300 ${!isOpen && 'lg:opacity-0 lg:hidden'}`}>
            LogisPro
          </span>
        </div>
        <button onClick={onMobileClose} className="lg:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
          <X size={20} />
        </button>
      </div>

      <nav className="flex-1 py-6 px-3 flex flex-col gap-2 overflow-y-auto">
        <p className={`px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 transition-opacity duration-300 ${!isOpen && 'lg:opacity-0 lg:hidden'}`}>
          Principal
        </p>
        
        {NAV_ITEMS.filter((item) => permissions.includes(item.permission)).map((item) => {
          const isActive = currentRoute === item.id;
          const Icon = item.icon; // Extraemos el componente icono para renderizarlo
          return (
            <button
              key={item.id}
              onClick={() => {
                onRouteChange(item.id);
                onMobileClose();
              }}
              className={`
                flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group relative
                ${isActive ? 'bg-[var(--color-primary)] text-white shadow-md shadow-[var(--color-primary)]/20' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}
              `}
              title={!isOpen ? item.label : undefined}
            >
              <Icon size={22} className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-[var(--color-primary)]'}`} />
              <span className={`font-medium whitespace-nowrap transition-opacity duration-300 ${!isOpen && 'lg:opacity-0 lg:hidden'}`}>
                {item.label}
              </span>
              {!isOpen && isActive && (
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-[var(--color-primary)] rounded-l-full"></div>
              )}
            </button>
          );
        })}
      </nav>

    </>
);

export const Sidebar = ({ isOpen, isMobileOpen, onMobileClose, currentRoute, onRouteChange, permissions, brandLogoUrl }: SidebarProps) => {
  const desktopClasses = `hidden lg:flex flex-col bg-white border-r border-slate-200 transition-all duration-300 ease-in-out z-10 ${isOpen ? 'w-72' : 'w-20'}`;
  const mobileClasses = `fixed inset-y-0 left-0 transform ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:hidden flex flex-col w-72 bg-white shadow-2xl z-50 transition-transform duration-300 ease-in-out`;

  const contentProps: SidebarContentProps = {
    isOpen,
    onMobileClose,
    currentRoute,
    onRouteChange,
    permissions,
    brandLogoUrl,
  };

  return (
    <>
      {isMobileOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden transition-opacity" onClick={onMobileClose} />
      )}
      <aside className={desktopClasses}><SidebarContent {...contentProps} /></aside>
      <aside className={mobileClasses}><SidebarContent {...contentProps} /></aside>
    </>
  );
};

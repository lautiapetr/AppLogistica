import React, { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Menu, ChevronDown, LogOut, Copy, Check, Settings } from 'lucide-react';
import { supabase } from '../../config/supabase';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../services/notifications';
import type { AppUser, NotificationRecord, RouteType } from '../../types';

interface TopbarProps {
  onMenuToggle: () => void;
  onRouteChange: (route: RouteType) => void;
  user: AppUser;
}

export const Topbar: React.FC<TopbarProps> = ({ onMenuToggle, onRouteChange, user }) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  const refreshNotifications = useCallback(async () => {
    try {
      setNotifications(await listNotifications());
    } catch {
      // The Topbar remains usable if notifications fail independently.
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadInitialNotifications = async () => {
      try {
        const initialNotifications = await listNotifications();
        if (!isCancelled) setNotifications(initialNotifications);
      } catch {
        // The Topbar remains usable if notifications fail independently.
      }
    };

    void loadInitialNotifications();

    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_profile_id=eq.${user.id}`,
        },
        () => void refreshNotifications(),
      )
      .subscribe();

    return () => {
      isCancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [refreshNotifications, user.id]);

  const visibleNotifications = user.preferences?.membershipNotifications === false
    ? []
    : notifications;
  const unreadCount = visibleNotifications
    .filter((notification) => notification.read_at === null).length;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // La app detectará el cambio y te enviará al Login automáticamente
  };

  const copyCode = () => {
    if (user.joinCode) {
      navigator.clipboard.writeText(user.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const openNotification = async (notification: NotificationRecord) => {
    if (!notification.read_at) {
      setNotifications((current) => current.map((item) => (
        item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item
      )));
      try {
        await markNotificationRead(notification.id);
      } catch {
        void refreshNotifications();
      }
    }

    if (
      notification.type === 'membership_request'
      && user.permissions.includes('members.view')
    ) {
      onRouteChange('team');
      setShowNotifications(false);
    }
  };

  const readAll = async () => {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((notification) => (
      notification.read_at ? notification : { ...notification, read_at: readAt }
    )));
    try {
      await markAllNotificationsRead();
    } catch {
      void refreshNotifications();
    }
  };

  return (
    <header className="bg-white border-b border-slate-200 h-16 px-4 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-4">
        <button 
          onClick={onMenuToggle}
          className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        
        {/* Mostramos el nombre de la empresa y el código */}
        <div className="hidden md:flex items-center gap-3 ml-2 border-l pl-4 border-slate-200">
          <span className="font-semibold text-slate-800">{user.companyName}</span>
          {user.role === 'admin' && (
            <div 
              onClick={copyCode}
              className="flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-full text-sm cursor-pointer hover:bg-slate-200 transition-colors"
              title="Copiar código de invitación"
            >
              <span className="text-slate-500">Código:</span>
              <span className="font-mono font-bold text-[var(--color-primary)]">{user.joinCode}</span>
              {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        {user.preferences?.notificationsEnabled !== false && <div className="relative">
          <button
            type="button"
            aria-label="Notificaciones"
            onClick={() => {
              setShowNotifications((current) => !current);
              setShowProfileMenu(false);
            }}
            className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-5 text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <h2 className="font-bold text-slate-900">Notificaciones</h2>
                  <p className="text-xs text-slate-500">{unreadCount ? `${unreadCount} sin leer` : 'Todo al día'}</p>
                </div>
                {unreadCount > 0 && (
                  <button type="button" onClick={() => void readAll()} className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-primary)] hover:underline">
                    <CheckCheck size={15} /> Marcar leídas
                  </button>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto p-2">
                {visibleNotifications.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-slate-400">
                    <Bell size={28} className="mx-auto mb-3 text-slate-300" />
                    Todavía no tienes notificaciones.
                  </div>
                ) : visibleNotifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => void openNotification(notification)}
                    className={`relative w-full rounded-xl px-3 py-3 text-left transition-colors hover:bg-slate-50 ${notification.read_at ? '' : 'bg-[var(--color-primary)]/5'}`}
                  >
                    {!notification.read_at && <span className="absolute right-3 top-4 h-2 w-2 rounded-full bg-[var(--color-primary)]" />}
                    <span className="block pr-5 text-sm font-semibold text-slate-800">{notification.title}</span>
                    <span className="mt-1 block pr-4 text-xs leading-5 text-slate-500">{notification.body}</span>
                    <span className="mt-1.5 block text-[11px] text-slate-400">
                      {new Date(notification.created_at).toLocaleString(
                        user.companySettings?.locale ?? 'es-AR',
                        {
                          dateStyle: 'short',
                          timeStyle: 'short',
                          timeZone: user.companySettings?.timezone,
                        },
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>}
        
        <div className="relative">
          <button 
            onClick={() => {
              setShowProfileMenu(!showProfileMenu);
              setShowNotifications(false);
            }}
            className="flex items-center gap-3 p-1.5 hover:bg-slate-50 rounded-lg transition-colors border border-transparent hover:border-slate-200"
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-lg object-cover shadow-sm" />
            ) : (
              <div className="w-8 h-8 bg-gradient-to-tr from-[var(--color-primary)] to-[var(--color-accent)] rounded-lg text-white flex items-center justify-center font-bold text-sm shadow-sm">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="hidden md:block text-left">
              <p className="text-sm font-semibold text-slate-700 leading-none">{user.name}</p>
              <p className="text-xs text-slate-500 mt-1 capitalize">{user.role}</p>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 hidden md:block" />
          </button>

          {showProfileMenu && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-100 py-2">
              <div className="px-4 py-2 border-b border-slate-100 md:hidden">
                <p className="text-sm font-semibold text-slate-800">{user.name}</p>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>
              {user.permissions.includes('settings.view') && (
                <button
                  type="button"
                  onClick={() => {
                    onRouteChange('settings');
                    setShowProfileMenu(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                >
                  <Settings className="h-4 w-4" />
                  Configuración
                </button>
              )}
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Cerrar Sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

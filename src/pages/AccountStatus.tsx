import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AlertCircle, Ban, Building, Clock3, LogOut, RefreshCw, UserPlus, UserX } from 'lucide-react';
import { supabase } from '../config/supabase';
import {
  ensureUserProfile,
  getErrorMessage,
  getOnboardingData,
} from '../services/auth';
import type { AppUser } from '../types';

interface AccountSetupPageProps {
  session: Session;
  initialError: string;
  onCompleted: () => Promise<void>;
}

type SetupMode = 'company' | 'employee';

export const AccountSetupPage = ({
  session,
  initialError,
  onCompleted,
}: AccountSetupPageProps) => {
  const onboarding = getOnboardingData(session.user);
  const [mode, setMode] = useState<SetupMode>(onboarding?.kind ?? 'company');
  const [fullName, setFullName] = useState(onboarding?.fullName ?? '');
  const [companyName, setCompanyName] = useState(
    onboarding?.kind === 'company' ? onboarding.companyName : '',
  );
  const [invitationCode, setInvitationCode] = useState(
    onboarding?.kind === 'employee' ? onboarding.invitationCode : '',
  );
  const [error, setError] = useState(initialError);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const metadata = mode === 'company'
        ? {
            onboarding_type: 'company',
            company_name: companyName.trim(),
            full_name: fullName.trim(),
            invitation_code: null,
          }
        : {
            onboarding_type: 'employee',
            invitation_code: invitationCode.trim().toUpperCase(),
            full_name: fullName.trim(),
            company_name: null,
          };

      const { data, error: updateError } = await supabase.auth.updateUser({ data: metadata });
      if (updateError) throw updateError;

      await ensureUserProfile(data.user);
      await onCompleted();
    } catch (caughtError: unknown) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
        <h1 className="text-2xl font-bold text-slate-900">Completar registro</h1>
        <p className="mt-2 text-sm text-slate-500">
          Tu sesión está activa, pero todavía falta crear el perfil de LogisPro.
        </p>

        {error && (
          <div className="mt-5 flex gap-3 rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setMode('company')}
            className={`rounded-xl border p-4 text-left transition-colors ${
              mode === 'company'
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Building size={20} />
            <span className="mt-2 block text-sm font-semibold">Crear empresa</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('employee')}
            className={`rounded-xl border p-4 text-left transition-colors ${
              mode === 'employee'
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <UserPlus size={20} />
            <span className="mt-2 block text-sm font-semibold">Unirme a empresa</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nombre completo</label>
            <input
              required
              minLength={2}
              maxLength={120}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
            />
          </div>

          {mode === 'company' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nombre de la empresa</label>
              <input
                required
                minLength={2}
                maxLength={120}
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Código de ingreso</label>
              <input
                required
                maxLength={8}
                value={invitationCode}
                onChange={(event) => setInvitationCode(event.target.value.toUpperCase())}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-center font-mono uppercase tracking-widest outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
              />
            </div>
          )}

          <button
            disabled={isLoading}
            className="w-full rounded-xl bg-[var(--color-primary)] px-4 py-3 font-medium text-white shadow-md shadow-[var(--color-primary)]/20 transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? 'Completando registro...' : 'Continuar'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          className="mt-4 flex w-full items-center justify-center gap-2 py-2 text-sm text-slate-500 hover:text-red-600"
        >
          <LogOut size={16} /> Cerrar sesión
        </button>
      </div>
    </div>
  );
};

interface RestrictedAccountPageProps {
  user: AppUser;
  onRefresh: () => Promise<void>;
}

const RESTRICTION_PRESENTATION = {
  pending: {
    title: 'Aprobación pendiente',
    message: 'Un administrador debe aceptar tu solicitud antes de que puedas acceder a los datos de la empresa.',
    classes: 'bg-amber-50 text-amber-600',
    icon: Clock3,
  },
  rejected: {
    title: 'Solicitud rechazada',
    message: 'Un administrador rechazó tu solicitud. Puedes contactarlo si crees que se trata de un error.',
    classes: 'bg-red-50 text-red-600',
    icon: UserX,
  },
  suspended: {
    title: 'Acceso suspendido',
    message: 'Tu acceso operativo fue suspendido. Un administrador puede volver a habilitarlo desde la gestión del equipo.',
    classes: 'bg-slate-100 text-slate-600',
    icon: Ban,
  },
} as const;

export const RestrictedAccountPage = ({ user, onRefresh }: RestrictedAccountPageProps) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const presentation = user.status === 'active'
    ? RESTRICTION_PRESENTATION.pending
    : RESTRICTION_PRESENTATION[user.status];
  const StatusIcon = presentation.icon;

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/50">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ${presentation.classes}`}>
          <StatusIcon size={32} />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-slate-900">{presentation.title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Hola, {user.name}. {presentation.message}
        </p>
        <button
          type="button"
          disabled={isRefreshing}
          onClick={() => void refresh()}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-3 font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
        >
          <RefreshCw size={17} className={isRefreshing ? 'animate-spin' : ''} />
          {isRefreshing ? 'Verificando...' : 'Verificar aprobación'}
        </button>
        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          className="mt-3 flex w-full items-center justify-center gap-2 py-2 text-sm text-slate-500 hover:text-red-600"
        >
          <LogOut size={16} /> Cerrar sesión
        </button>
      </div>
    </div>
  );
};

interface AccessErrorPageProps {
  message: string;
  onRetry: () => Promise<void>;
}

export const AccessErrorPage = ({ message, onRetry }: AccessErrorPageProps) => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
    <div className="w-full max-w-md rounded-3xl border border-red-100 bg-white p-8 text-center shadow-xl shadow-slate-200/50">
      <AlertCircle size={40} className="mx-auto text-red-500" />
      <h1 className="mt-4 text-xl font-bold text-slate-900">No pudimos cargar tu cuenta</h1>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <button
        type="button"
        onClick={() => void onRetry()}
        className="mt-6 w-full rounded-xl bg-[var(--color-primary)] px-4 py-3 font-medium text-white hover:bg-[var(--color-primary-hover)]"
      >
        Reintentar
      </button>
      <button
        type="button"
        onClick={() => void supabase.auth.signOut()}
        className="mt-3 flex w-full items-center justify-center gap-2 py-2 text-sm text-slate-500 hover:text-red-600"
      >
        <LogOut size={16} /> Cerrar sesión
      </button>
    </div>
  </div>
);

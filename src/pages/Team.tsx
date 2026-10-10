import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserRound,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '../config/supabase';
import { getErrorMessage } from '../services/auth';
import {
  listCompanyMembers,
  manageEmployeeAccess,
  reviewMembershipRequest,
} from '../services/team';
import { assignEmployeeRole, listCompanyRoleOptions } from '../services/roles';
import type { CompanyRoleOption, ProfileStatus, TeamMemberRecord } from '../types';

type MemberFilter = 'all' | ProfileStatus;
type MemberAction = 'approve' | 'reject' | 'suspend' | 'reactivate';

const STATUS_PRESENTATION: Record<ProfileStatus, {
  label: string;
  classes: string;
  icon: typeof Clock3;
}> = {
  pending: { label: 'Pendiente', classes: 'bg-amber-50 text-amber-700', icon: Clock3 },
  active: { label: 'Activo', classes: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
  suspended: { label: 'Suspendido', classes: 'bg-slate-100 text-slate-600', icon: Ban },
  rejected: { label: 'Rechazado', classes: 'bg-red-50 text-red-700', icon: UserX },
};

const FILTERS: Array<{ value: MemberFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'active', label: 'Activos' },
  { value: 'suspended', label: 'Suspendidos' },
  { value: 'rejected', label: 'Rechazados' },
];

const ACTION_COPY: Record<MemberAction, {
  title: string;
  description: (member: TeamMemberRecord) => string;
  button: string;
  classes: string;
}> = {
  approve: {
    title: 'Aprobar ingreso',
    description: (member) => `${member.full_name} podrá acceder inmediatamente a los datos operativos de la empresa.`,
    button: 'Aprobar empleado',
    classes: 'bg-emerald-600 hover:bg-emerald-700',
  },
  reject: {
    title: 'Rechazar solicitud',
    description: (member) => `${member.full_name} no podrá acceder a la empresa. La decisión quedará registrada.`,
    button: 'Rechazar solicitud',
    classes: 'bg-red-600 hover:bg-red-700',
  },
  suspend: {
    title: 'Suspender acceso',
    description: (member) => `${member.full_name} perderá inmediatamente el acceso operativo hasta que lo reactives.`,
    button: 'Suspender acceso',
    classes: 'bg-slate-800 hover:bg-slate-900',
  },
  reactivate: {
    title: 'Habilitar acceso',
    description: (member) => `${member.full_name} recuperará inmediatamente el acceso operativo.`,
    button: 'Habilitar empleado',
    classes: 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)]',
  },
};

interface TeamPageProps {
  canReview: boolean;
  canManageRoles: boolean;
}

export const TeamPage = ({ canReview, canManageRoles }: TeamPageProps) => {
  const [members, setMembers] = useState<TeamMemberRecord[]>([]);
  const [roles, setRoles] = useState<CompanyRoleOption[]>([]);
  const [filter, setFilter] = useState<MemberFilter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{
    member: TeamMemberRecord;
    action: MemberAction;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [assigningProfileId, setAssigningProfileId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setMembers(await listCompanyMembers());
    } catch (caughtError: unknown) {
      setLoadError(getErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadInitialMembers = async () => {
      try {
        const initialMembers = await listCompanyMembers();
        if (!isCancelled) setMembers(initialMembers);
      } catch (caughtError: unknown) {
        if (!isCancelled) setLoadError(getErrorMessage(caughtError));
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    void loadInitialMembers();

    const channel = supabase
      .channel('team-profile-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          void listCompanyMembers().then(setMembers).catch(() => undefined);
        },
      )
      .subscribe();

    return () => {
      isCancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [loadMembers]);

  useEffect(() => {
    let isCancelled = false;
    const loadRoles = async () => {
      try {
        const roleData = await listCompanyRoleOptions();
        if (!isCancelled) setRoles(roleData);
      } catch (caughtError: unknown) {
        if (!isCancelled) setRoleError(getErrorMessage(caughtError));
      }
    };
    void loadRoles();
    return () => { isCancelled = true; };
  }, []);

  const counts = useMemo(() => ({
    all: members.length,
    pending: members.filter((member) => member.status === 'pending').length,
    active: members.filter((member) => member.status === 'active').length,
    suspended: members.filter((member) => member.status === 'suspended').length,
    rejected: members.filter((member) => member.status === 'rejected').length,
  }), [members]);
  const visibleMembers = filter === 'all'
    ? members
    : members.filter((member) => member.status === filter);

  const openAction = (member: TeamMemberRecord, action: MemberAction) => {
    setActionError(null);
    setActionTarget({ member, action });
  };

  const confirmAction = async () => {
    if (!actionTarget) return;
    setIsSaving(true);
    setActionError(null);

    try {
      const { member, action } = actionTarget;
      const updatedMember = action === 'approve' || action === 'reject'
        ? await reviewMembershipRequest(member.id, action)
        : await manageEmployeeAccess(
            member.id,
            action === 'suspend' ? 'suspended' : 'active',
          );

      setMembers((current) => current.map((currentMember) => (
        currentMember.id === updatedMember.id ? updatedMember : currentMember
      )));
      setNotice(
        action === 'approve' ? 'Solicitud aprobada correctamente.'
          : action === 'reject' ? 'Solicitud rechazada.'
            : action === 'suspend' ? 'Acceso suspendido.'
              : 'Acceso habilitado nuevamente.',
      );
      setActionTarget(null);
    } catch (caughtError: unknown) {
      setActionError(getErrorMessage(caughtError));
    } finally {
      setIsSaving(false);
    }
  };

  const changeMemberRole = async (member: TeamMemberRecord, roleId: string) => {
    if (!roleId || roleId === member.role_id) return;
    setAssigningProfileId(member.id);
    setNotice(null);
    setRoleError(null);
    try {
      const updatedMember = await assignEmployeeRole(member.id, roleId);
      setMembers((current) => current.map((currentMember) => (
        currentMember.id === updatedMember.id ? updatedMember : currentMember
      )));
      setNotice(`Rol de ${member.full_name} actualizado correctamente.`);
    } catch (caughtError: unknown) {
      setRoleError(getErrorMessage(caughtError));
    } finally {
      setAssigningProfileId(null);
    }
  };

  return (
    <div className="animate-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Equipo</h1>
          <p className="mt-1 text-slate-500">Consulta miembros, accesos y roles asignados.</p>
        </div>
        <button type="button" onClick={() => void loadMembers()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <RefreshCw size={17} className={isLoading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="flex items-center gap-2"><Check size={17} /> {notice}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}><X size={17} /></button>
        </div>
      )}

      {roleError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{roleError}</span>
          <button type="button" aria-label="Cerrar error" onClick={() => setRoleError(null)}><X size={17} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ['Solicitudes', counts.pending, Clock3, 'bg-amber-50 text-amber-600'],
          ['Activos', counts.active, UserCheck, 'bg-emerald-50 text-emerald-600'],
          ['Suspendidos', counts.suspended, Ban, 'bg-slate-100 text-slate-600'],
          ['Total', counts.all, Users, 'bg-violet-50 text-[var(--color-primary)]'],
        ] as const).map(([label, value, Icon, classes]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${classes}`}><Icon size={18} /></div>
            <p className="mt-3 text-2xl font-bold text-slate-900">{isLoading ? '—' : value}</p>
            <p className="text-xs font-medium text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((option) => (
          <button key={option.value} type="button" onClick={() => setFilter(option.value)} className={`whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium ${filter === option.value ? 'bg-[var(--color-primary)] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {option.label} <span className="ml-1 opacity-70">{counts[option.value]}</span>
          </button>
        ))}
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <AlertCircle size={36} className="mx-auto text-red-500" />
          <h2 className="mt-4 font-semibold text-slate-900">No pudimos cargar el equipo</h2>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
          <button type="button" onClick={() => void loadMembers()} className="mt-5 rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white">Reintentar</button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
      ) : visibleMembers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Users size={40} className="mx-auto text-slate-300" />
          <h2 className="mt-4 font-semibold text-slate-900">No hay miembros en esta categoría</h2>
          <p className="mt-2 text-sm text-slate-500">Las nuevas solicitudes aparecerán aquí automáticamente.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visibleMembers.map((member) => {
            const presentation = STATUS_PRESENTATION[member.status];
            const StatusIcon = presentation.icon;
            return (
              <article key={member.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)]/10 font-bold text-[var(--color-primary)]">{member.full_name.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                      <h2 className="truncate font-bold text-slate-900">{member.full_name}</h2>
                      <p className="truncate text-sm text-slate-500">{member.email ?? 'Sin correo disponible'}</p>
                    </div>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${presentation.classes}`}><StatusIcon size={13} /> {presentation.label}</span>
                </div>

                <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
                  {member.role === 'admin' ? <><ShieldCheck size={15} className="text-[var(--color-primary)]" /> Administrador protegido</> : <><UserRound size={15} /> {roles.find((role) => role.id === member.role_id)?.name ?? 'Empleado'}</>}
                </div>

                {member.role === 'employee' && canManageRoles && (
                  <label className="mt-4 block text-xs font-medium text-slate-600">
                    Rol asignado
                    <select value={member.role_id ?? ''} disabled={assigningProfileId === member.id} onChange={(event) => void changeMemberRole(member, event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-60">
                      {roles.filter((role) => role.isActive).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                  </label>
                )}

                {member.role === 'employee' && canReview && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {member.status === 'pending' && (
                      <>
                        <button type="button" onClick={() => openAction(member, 'approve')} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"><UserCheck size={16} /> Aprobar</button>
                        <button type="button" onClick={() => openAction(member, 'reject')} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"><UserX size={16} /> Rechazar</button>
                      </>
                    )}
                    {member.status === 'active' && <button type="button" onClick={() => openAction(member, 'suspend')} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Ban size={16} /> Suspender</button>}
                    {(member.status === 'suspended' || member.status === 'rejected') && <button type="button" onClick={() => openAction(member, 'reactivate')} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]"><UserCheck size={16} /> Habilitar acceso</button>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {actionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Cancelar acción" onClick={() => !isSaving && setActionTarget(null)} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
          <div role="alertdialog" aria-modal="true" className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-slate-900">{ACTION_COPY[actionTarget.action].title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{ACTION_COPY[actionTarget.action].description(actionTarget.member)}</p>
            {actionError && <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" disabled={isSaving} onClick={() => setActionTarget(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cancelar</button>
              <button type="button" disabled={isSaving} onClick={() => void confirmAction()} className={`rounded-xl px-4 py-2.5 font-medium text-white disabled:opacity-60 ${ACTION_COPY[actionTarget.action].classes}`}>{isSaving ? 'Guardando...' : ACTION_COPY[actionTarget.action].button}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

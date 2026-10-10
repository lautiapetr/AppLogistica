import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Edit3,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { getErrorMessage } from '../services/auth';
import { getRolesAndPermissions, saveCompanyRole } from '../services/roles';
import type {
  CompanyRoleInput,
  CompanyRoleRecord,
  PermissionDefinition,
  PermissionKey,
  RolesAndPermissions,
} from '../types';

const MODULE_LABELS: Record<string, string> = {
  shipments: 'Movimientos',
  clients: 'Clientes',
  zones: 'Zonas',
  statistics: 'Estadísticas',
  members: 'Equipo',
  settings: 'Configuración',
  pricing: 'Valores económicos',
};

const DEPENDENCIES: Partial<Record<PermissionKey, PermissionKey[]>> = {
  'shipments.create': ['shipments.view', 'clients.view', 'zones.view'],
  'shipments.update': ['shipments.view', 'clients.view', 'zones.view'],
  'shipments.delete': ['shipments.view'],
  'clients.manage': ['clients.view'],
  'zones.manage': ['zones.view'],
  'statistics.view': ['shipments.view'],
  'statistics.export': ['statistics.view'],
  'members.review': ['members.view'],
  'members.manage_roles': ['members.view'],
  'settings.manage': ['settings.view'],
  'pricing.manage': ['pricing.view'],
};

const expandPermissions = (permissions: PermissionKey[]): PermissionKey[] => {
  const expanded = new Set(permissions);
  let changed = true;
  while (changed) {
    changed = false;
    [...expanded].forEach((permission) => {
      DEPENDENCIES[permission]?.forEach((dependency) => {
        if (!expanded.has(dependency)) {
          expanded.add(dependency);
          changed = true;
        }
      });
    });
  }
  return [...expanded];
};

const dependsOn = (permission: PermissionKey, dependency: PermissionKey): boolean => {
  const directDependencies = DEPENDENCIES[permission] ?? [];
  return directDependencies.includes(dependency)
    || directDependencies.some((directDependency) => dependsOn(directDependency, dependency));
};

interface RoleModalProps {
  role: CompanyRoleRecord | null;
  cloneSource: CompanyRoleRecord | null;
  permissions: PermissionDefinition[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: CompanyRoleInput) => Promise<void>;
}

const RoleModal = ({
  role,
  cloneSource,
  permissions,
  isSaving,
  error,
  onClose,
  onSubmit,
}: RoleModalProps) => {
  const source = role ?? cloneSource;
  const [name, setName] = useState(
    cloneSource ? `${cloneSource.name} (copia)` : (role?.name ?? ''),
  );
  const [description, setDescription] = useState(source?.description ?? '');
  const [isActive, setIsActive] = useState(source?.isActive ?? true);
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionKey[]>(
    source?.permissionKeys ?? [],
  );

  const groupedPermissions = useMemo(() => permissions.reduce<Record<string, PermissionDefinition[]>>(
    (groups, permission) => {
      (groups[permission.module] ??= []).push(permission);
      return groups;
    },
    {},
  ), [permissions]);

  const togglePermission = (permissionKey: PermissionKey) => {
    setSelectedPermissions((current) => {
      if (!current.includes(permissionKey)) {
        return expandPermissions([...current, permissionKey]);
      }
      return current.filter((selected) => (
        selected !== permissionKey && !dependsOn(selected, permissionKey)
      ));
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cerrar editor de rol" onClick={() => !isSaving && onClose()} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
      <form onSubmit={(event) => { event.preventDefault(); void onSubmit({ name, description, permissionKeys: selectedPermissions, isActive }); }} className="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{cloneSource ? 'Clonar rol' : role ? 'Editar rol' : 'Nuevo rol'}</h2>
            <p className="mt-1 text-sm text-slate-500">Los permisos dependientes se seleccionan automáticamente.</p>
          </div>
          <button type="button" disabled={isSaving} onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <label className="text-sm font-medium text-slate-700 md:col-span-1">
            Nombre
            <input required minLength={2} maxLength={80} disabled={role?.isSystem || isSaving} value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[var(--color-primary)] disabled:bg-slate-50" />
          </label>
          <label className="text-sm font-medium text-slate-700 md:col-span-2">
            Descripción
            <input maxLength={240} disabled={isSaving} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[var(--color-primary)]" />
          </label>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {Object.entries(groupedPermissions).map(([module, modulePermissions]) => (
            <section key={module} className="rounded-2xl border border-slate-200 p-4">
              <h3 className="font-semibold text-slate-900">{MODULE_LABELS[module] ?? module}</h3>
              <div className="mt-3 space-y-2">
                {modulePermissions.map((permission) => {
                  const checked = selectedPermissions.includes(permission.key);
                  return (
                    <label key={permission.key} className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${checked ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5' : 'border-slate-100 hover:bg-slate-50'}`}>
                      <input type="checkbox" checked={checked} disabled={isSaving} onChange={() => togglePermission(permission.key)} className="mt-1 h-4 w-4 accent-[var(--color-primary)]" />
                      <span><span className="block text-sm font-medium text-slate-800">{permission.label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{permission.description}</span></span>
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-700">{selectedPermissions.length} permisos efectivos</p>
            <p className="text-xs text-slate-500">Esta vista previa coincide con lo que se guardará.</p>
          </div>
          {!role?.isSystem && (
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={isActive} disabled={isSaving} onChange={(event) => setIsActive(event.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" /> Rol activo</label>
          )}
        </div>

        {error && <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" disabled={isSaving} onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cancelar</button>
          <button disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-60">{isSaving ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />} Guardar rol</button>
        </div>
      </form>
    </div>
  );
};

export const RolesPage = () => {
  const [data, setData] = useState<RolesAndPermissions | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<CompanyRoleRecord | null>(null);
  const [cloneSource, setCloneSource] = useState<CompanyRoleRecord | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRoles = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setData(await getRolesAndPermissions());
    } catch (caughtError: unknown) {
      setLoadError(getErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;
    const loadInitialRoles = async () => {
      try {
        const initialData = await getRolesAndPermissions();
        if (!isCancelled) setData(initialData);
      } catch (caughtError: unknown) {
        if (!isCancelled) setLoadError(getErrorMessage(caughtError));
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };
    void loadInitialRoles();
    return () => { isCancelled = true; };
  }, []);

  const closeModal = () => {
    if (isSaving) return;
    setEditingRole(null);
    setCloneSource(null);
    setIsCreating(false);
    setSaveError(null);
  };

  const saveRole = async (input: CompanyRoleInput) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveCompanyRole(editingRole?.id ?? null, input);
      await loadRoles();
      setNotice(editingRole ? 'Rol actualizado correctamente.' : 'Rol creado correctamente.');
      setEditingRole(null);
      setCloneSource(null);
      setIsCreating(false);
    } catch (caughtError: unknown) {
      setSaveError(getErrorMessage(caughtError));
    } finally {
      setIsSaving(false);
    }
  };

  const modalOpen = isCreating || editingRole !== null || cloneSource !== null;

  return (
    <div className="animate-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">Roles y permisos</h1><p className="mt-1 text-slate-500">Define qué puede consultar y administrar cada empleado.</p></div>
        <button type="button" onClick={() => { setSaveError(null); setIsCreating(true); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white hover:bg-[var(--color-primary-hover)]"><Plus size={18} /> Nuevo rol</button>
      </div>

      {notice && <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}><X size={17} /></button></div>}

      {loadError ? (
        <div className="rounded-2xl border border-red-100 bg-white p-8 text-center"><AlertCircle size={36} className="mx-auto text-red-500" /><h2 className="mt-4 font-semibold">No pudimos cargar los roles</h2><p className="mt-2 text-sm text-slate-500">{loadError}</p><button type="button" onClick={() => void loadRoles()} className="mt-5 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-white">Reintentar</button></div>
      ) : isLoading || !data ? (
        <div className="grid gap-4 md:grid-cols-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.roles.map((role) => (
            <article key={role.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${role.isActive ? 'border-slate-200' : 'border-slate-200 opacity-65'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-[var(--color-primary)]">{role.isSystem ? <LockKeyhole size={19} /> : <ShieldCheck size={19} />}</div><div><h2 className="font-bold text-slate-900">{role.name}</h2><p className="mt-1 text-sm text-slate-500">{role.description || 'Sin descripción'}</p></div></div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${role.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{role.isActive ? 'Activo' : 'Inactivo'}</span>
              </div>
              <div className="mt-5 flex flex-wrap gap-2 text-xs"><span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-slate-600"><Users size={13} /> {role.memberCount} empleados</span><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[var(--color-primary)]">{role.permissionKeys.length} permisos</span>{role.isDefault && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">Predeterminado</span>}</div>
              <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => { setSaveError(null); setEditingRole(role); }} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Edit3 size={15} /> Editar</button>
                <button type="button" onClick={() => { setSaveError(null); setCloneSource(role); }} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Copy size={15} /> Clonar</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {modalOpen && data && <RoleModal key={editingRole?.id ?? cloneSource?.id ?? 'new'} role={editingRole} cloneSource={cloneSource} permissions={data.permissions} isSaving={isSaving} error={saveError} onClose={closeModal} onSubmit={saveRole} />}
    </div>
  );
};

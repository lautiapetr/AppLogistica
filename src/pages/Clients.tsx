import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Edit3,
  Fingerprint,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { ClientFormModal } from '../components/clients/ClientFormModal';
import { getErrorMessage } from '../services/auth';
import {
  createClient,
  deleteClient,
  getClientDisplayName,
  listClients,
  updateClient,
} from '../services/clients';
import type { ClientInput, ClientRecord } from '../types';

interface ClientsPageProps {
  canManage: boolean;
}

const sortClients = (clients: ClientRecord[]) =>
  [...clients].sort((first, second) => (
    getClientDisplayName(first).localeCompare(getClientDisplayName(second), 'es')
  ));

const getInitials = (businessName: string) => businessName
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((word) => word[0])
  .join('')
  .toUpperCase();

export const ClientsPage = ({ canManage }: ClientsPageProps) => {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshClients = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      setClients(await listClients());
    } catch (caughtError: unknown) {
      setLoadError(getErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadInitialClients = async () => {
      try {
        const initialClients = await listClients();
        if (!isCancelled) setClients(sortClients(initialClients));
      } catch (caughtError: unknown) {
        if (!isCancelled) setLoadError(getErrorMessage(caughtError));
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    void loadInitialClients();

    return () => {
      isCancelled = true;
    };
  }, []);

  const visibleClients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es');
    if (!query) return clients;

    return clients.filter((client) => (
      [
        getClientDisplayName(client),
        client.document_number,
        client.tax_id,
        client.contact_email,
        client.contact_phone,
        client.address,
      ].some((value) => value?.toLocaleLowerCase('es').includes(query))
    ));
  }, [clients, search]);

  const openCreateForm = () => {
    setEditingClient(null);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (client: ClientRecord) => {
    setEditingClient(client);
    setFormError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (isSaving) return;
    setIsFormOpen(false);
    setEditingClient(null);
    setFormError(null);
  };

  const saveClient = async (input: ClientInput) => {
    setIsSaving(true);
    setFormError(null);

    try {
      if (editingClient) {
        const updatedClient = await updateClient(editingClient.id, input);
        setClients((current) => sortClients(
          current.map((client) => client.id === updatedClient.id ? updatedClient : client),
        ));
        setNotice('Cliente actualizado correctamente.');
      } else {
        const newClient = await createClient(input);
        setClients((current) => sortClients([...current, newClient]));
        setNotice('Cliente creado correctamente.');
      }

      setIsFormOpen(false);
      setEditingClient(null);
    } catch (caughtError: unknown) {
      setFormError(getErrorMessage(caughtError));
    } finally {
      setIsSaving(false);
    }
  };

  const requestDelete = (client: ClientRecord) => {
    setDeleteError(null);
    setDeleteTarget(client);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteClient(deleteTarget.id);
      setClients((current) => current.filter((client) => client.id !== deleteTarget.id));
      setNotice('Cliente eliminado correctamente.');
      setDeleteTarget(null);
    } catch (caughtError: unknown) {
      setDeleteError(getErrorMessage(caughtError));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="animate-in">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Directorio de Clientes</h1>
          <p className="mt-1 text-slate-500">Administra empresas e individuos que reciben tus servicios logísticos.</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreateForm}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white shadow-sm shadow-[var(--color-primary)]/30 transition-colors hover:bg-[var(--color-primary-hover)] sm:w-auto"
          >
            <Plus size={18} /> Agregar cliente
          </button>
        )}
      </div>

      {notice && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            <X size={17} />
          </button>
        </div>
      )}

      <div className="mb-6 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <Search size={20} className="ml-3 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre, DNI, CUIT/CUIL, correo..."
          className="w-full bg-transparent py-2 text-slate-700 outline-none placeholder:text-slate-400"
        />
      </div>

      {!canManage && (
        <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Puedes consultar el directorio. Tu rol no permite modificar clientes.
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white p-6">
              <div className="h-12 w-12 rounded-xl bg-slate-100" />
              <div className="mt-5 h-4 w-2/3 rounded bg-slate-100" />
              <div className="mt-3 h-3 w-1/2 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <AlertCircle size={36} className="mx-auto text-red-500" />
          <h2 className="mt-4 font-semibold text-slate-900">No pudimos cargar los clientes</h2>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
          <button
            type="button"
            onClick={() => void refreshClients()}
            className="mt-5 rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white hover:bg-[var(--color-primary-hover)]"
          >
            Reintentar
          </button>
        </div>
      ) : visibleClients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Users size={40} className="mx-auto text-slate-300" />
          <h2 className="mt-4 font-semibold text-slate-900">
            {search ? 'No encontramos coincidencias' : 'Todavía no hay clientes'}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {search
              ? 'Prueba con otro nombre o correo electrónico.'
              : 'Agrega el primer cliente para comenzar a registrar envíos.'}
          </p>
          {canManage && !search && (
            <button
              type="button"
              onClick={openCreateForm}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white hover:bg-[var(--color-primary-hover)]"
            >
              <Plus size={17} /> Agregar cliente
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {visibleClients.map((client) => (
            <article
              key={client.id}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--color-primary)]/10 bg-[var(--color-primary)]/5 font-bold text-[var(--color-primary)]">
                    {getInitials(getClientDisplayName(client)) || (
                      client.client_type === 'company' ? <Building2 size={20} /> : <UserRound size={20} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-slate-900">{getClientDisplayName(client)}</h2>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className="inline-flex rounded-full bg-[var(--color-primary)]/5 px-2 py-0.5 text-xs font-medium text-[var(--color-primary)]">
                        {client.client_type === 'company' ? 'Empresa' : 'Individuo'}
                      </span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        client.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {client.status === 'active' ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-2 text-sm text-slate-500">
                {client.document_number && (
                  <div className="flex items-center gap-2">
                    <Fingerprint size={16} className="shrink-0" /> DNI {client.document_number}
                  </div>
                )}
                {client.tax_id && (
                  <div className="flex items-center gap-2">
                    <Fingerprint size={16} className="shrink-0" />
                    {client.client_type === 'company' ? 'CUIT' : 'CUIL'} {client.tax_id}
                  </div>
                )}
                {client.contact_email && (
                  <a
                    href={`mailto:${client.contact_email}`}
                    className="flex items-center gap-2 truncate text-sm text-slate-500 hover:text-[var(--color-primary)]"
                  >
                    <Mail size={16} className="shrink-0" /> {client.contact_email}
                  </a>
                )}
                {client.contact_phone && (
                  <a href={`tel:${client.contact_phone}`} className="flex items-center gap-2 hover:text-[var(--color-primary)]">
                    <Phone size={16} className="shrink-0" /> {client.contact_phone}
                  </a>
                )}
                {client.address && (
                  <div className="flex items-start gap-2">
                    <MapPin size={16} className="mt-0.5 shrink-0" /> <span>{client.address}</span>
                  </div>
                )}
                {!client.document_number
                  && !client.tax_id
                  && !client.contact_email
                  && !client.contact_phone
                  && !client.address && (
                    <span className="text-slate-400">Sin datos opcionales</span>
                )}
              </div>

              {canManage && (
                <div className="mt-5 flex gap-2 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    onClick={() => openEditForm(client)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-[var(--color-primary)]/30 hover:bg-[var(--color-primary)]/5 hover:text-[var(--color-primary)]"
                  >
                    <Edit3 size={15} /> Editar
                  </button>
                  <button
                    type="button"
                    aria-label={`Eliminar ${getClientDisplayName(client)}`}
                    onClick={() => requestDelete(client)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {isFormOpen && (
        <ClientFormModal
          key={editingClient?.id ?? 'new-client'}
          client={editingClient}
          isSaving={isSaving}
          error={formError}
          onClose={closeForm}
          onSubmit={saveClient}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cancelar eliminación"
            onClick={() => !isDeleting && setDeleteTarget(null)}
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
          />
          <div role="alertdialog" aria-modal="true" className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <Trash2 size={22} />
            </div>
            <h2 className="mt-4 text-xl font-bold text-slate-900">Eliminar cliente</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Se eliminará{' '}
              <strong className="text-slate-700">{getClientDisplayName(deleteTarget)}</strong>{' '}
              del directorio. Esta acción no se puede deshacer. Si tiene movimientos asociados,
              deberás marcarlo como inactivo para conservar su historial.
            </p>
            {deleteError && (
              <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {deleteError}
              </div>
            )}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void confirmDelete()}
                className="rounded-xl bg-red-600 px-4 py-2.5 font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isDeleting ? 'Eliminando...' : 'Eliminar cliente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

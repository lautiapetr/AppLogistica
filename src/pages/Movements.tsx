import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Edit3,
  MapPin,
  Package,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { ShipmentFormModal } from '../components/shipments/ShipmentFormModal';
import { ShipmentPricingHistoryModal } from '../components/shipments/ShipmentPricingHistoryModal';
import { getErrorMessage } from '../services/auth';
import { getClientDisplayName, listClients } from '../services/clients';
import {
  createShipment,
  deleteShipment,
  listCurrentShipmentPricingSummaries,
  listShipments,
  listZonesForShipments,
  updateShipment,
} from '../services/shipments';
import { listZoneLocations } from '../services/zones';
import type {
  ClientRecord,
  ShipmentInput,
  ShipmentPricingSummary,
  ShipmentRecord,
  ShipmentStatus,
  StatisticsFilters,
  ZoneRecord,
  ZoneLocationRecord,
} from '../types';

const DATE_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const formatShipmentDate = (value: string): string => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return DATE_FORMATTER.format(new Date(year, month - 1, day));
};

const STATUS_OPTIONS: Array<{ value: ShipmentStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'in_transit', label: 'En tránsito' },
  { value: 'delivered', label: 'Entregados' },
  { value: 'incident', label: 'Incidencias' },
];

const STATUS_PRESENTATION: Record<ShipmentStatus, { label: string; classes: string }> = {
  pending: { label: 'Pendiente', classes: 'bg-amber-50 text-amber-700' },
  in_transit: { label: 'En tránsito', classes: 'bg-blue-50 text-blue-700' },
  delivered: { label: 'Entregado', classes: 'bg-emerald-50 text-emerald-700' },
  incident: { label: 'Incidencia', classes: 'bg-red-50 text-red-700' },
};

const getStatusPresentation = (status: string) => (
  STATUS_PRESENTATION[status as ShipmentStatus]
  ?? { label: status, classes: 'bg-slate-100 text-slate-600' }
);

const sortShipments = (shipments: ShipmentRecord[]) => [...shipments].sort((first, second) => (
  first.tracking_number.localeCompare(second.tracking_number, 'es')
));

interface MovementsPageProps {
  initialFilters?: StatisticsFilters;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canViewPricing: boolean;
  canManagePricing: boolean;
}

export const MovementsPage = ({
  initialFilters,
  canCreate,
  canUpdate,
  canDelete,
  canViewPricing,
  canManagePricing,
}: MovementsPageProps) => {
  const [shipments, setShipments] = useState<ShipmentRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [zones, setZones] = useState<ZoneRecord[]>([]);
  const [zoneLocations, setZoneLocations] = useState<ZoneLocationRecord[]>([]);
  const [pricingSummaries, setPricingSummaries] = useState<ShipmentPricingSummary[]>([]);
  const [pricingHistoryTarget, setPricingHistoryTarget] = useState<ShipmentRecord | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | 'all'>(
    initialFilters?.status ?? 'all',
  );
  const [dateFromFilter, setDateFromFilter] = useState(initialFilters?.dateFrom ?? '');
  const [dateToFilter, setDateToFilter] = useState(initialFilters?.dateTo ?? '');
  const [zoneFilter, setZoneFilter] = useState(initialFilters?.zoneId ?? '');
  const [clientFilter, setClientFilter] = useState(initialFilters?.clientId ?? '');
  const [destinationFilter, setDestinationFilter] = useState(
    initialFilters?.destinationPlaceId ?? '',
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingShipment, setEditingShipment] = useState<ShipmentRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShipmentRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMovementData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [shipmentData, clientData, zoneData, locationData, pricingData] = await Promise.all([
        listShipments(),
        listClients(),
        listZonesForShipments(),
        listZoneLocations(),
        canViewPricing ? listCurrentShipmentPricingSummaries() : Promise.resolve([]),
      ]);
      setShipments(sortShipments(shipmentData));
      setClients(clientData);
      setZones(zoneData);
      setZoneLocations(locationData);
      setPricingSummaries(pricingData);
    } catch (caughtError: unknown) {
      setLoadError(getErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }, [canViewPricing]);

  useEffect(() => {
    let isCancelled = false;

    const loadInitialData = async () => {
      try {
        const [shipmentData, clientData, zoneData, locationData, pricingData] = await Promise.all([
          listShipments(),
          listClients(),
          listZonesForShipments(),
          listZoneLocations(),
          canViewPricing ? listCurrentShipmentPricingSummaries() : Promise.resolve([]),
        ]);

        if (!isCancelled) {
          setShipments(sortShipments(shipmentData));
          setClients(clientData);
          setZones(zoneData);
          setZoneLocations(locationData);
          setPricingSummaries(pricingData);
        }
      } catch (caughtError: unknown) {
        if (!isCancelled) setLoadError(getErrorMessage(caughtError));
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    void loadInitialData();
    return () => {
      isCancelled = true;
    };
  }, [canViewPricing]);

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );
  const zonesById = useMemo(
    () => new Map(zones.map((zone) => [zone.id, zone])),
    [zones],
  );
  const pricingByShipmentId = useMemo(
    () => new Map(pricingSummaries.map((summary) => [summary.shipmentId, summary])),
    [pricingSummaries],
  );
  const destinationOptions = useMemo(() => {
    const destinations = new Map<string, string>();
    shipments.forEach((shipment) => {
      if (shipment.destination_place_id && shipment.destination_city) {
        destinations.set(shipment.destination_place_id, shipment.destination_city);
      }
    });
    return [...destinations.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((first, second) => first.label.localeCompare(second.label, 'es'));
  }, [shipments]);

  const visibleShipments = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es');

    return shipments.filter((shipment) => {
      if (statusFilter !== 'all' && shipment.status !== statusFilter) return false;
      if (dateFromFilter && shipment.shipment_date < dateFromFilter) return false;
      if (dateToFilter && shipment.shipment_date > dateToFilter) return false;
      if (zoneFilter && shipment.zone_id !== zoneFilter) return false;
      if (clientFilter && shipment.client_id !== clientFilter) return false;
      if (destinationFilter && shipment.destination_place_id !== destinationFilter) return false;
      if (!query) return true;

      const client = shipment.client_id ? clientsById.get(shipment.client_id) : null;
      const zone = shipment.zone_id ? zonesById.get(shipment.zone_id) : null;
      return [
        shipment.tracking_number,
        shipment.shipment_date,
        shipment.delivery_address,
        shipment.destination_city,
        client ? getClientDisplayName(client) : null,
        zone?.name,
      ].some((value) => value?.toLocaleLowerCase('es').includes(query));
    });
  }, [
    clientFilter,
    clientsById,
    dateFromFilter,
    dateToFilter,
    destinationFilter,
    search,
    shipments,
    statusFilter,
    zoneFilter,
    zonesById,
  ]);

  const hasActiveFilters = Boolean(
    search
    || statusFilter !== 'all'
    || dateFromFilter
    || dateToFilter
    || zoneFilter
    || clientFilter
    || destinationFilter,
  );

  const resetListFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setDateFromFilter('');
    setDateToFilter('');
    setZoneFilter('');
    setClientFilter('');
    setDestinationFilter('');
  };

  const openCreateForm = () => {
    if (!canCreate) return;
    if (!clients.some((client) => client.status === 'active')) {
      setNotice('Necesitas al menos un cliente activo antes de registrar un movimiento.');
      return;
    }

    setEditingShipment(null);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (shipment: ShipmentRecord) => {
    if (!canUpdate) return;
    setEditingShipment(shipment);
    setFormError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (isSaving) return;
    setIsFormOpen(false);
    setEditingShipment(null);
    setFormError(null);
  };

  const saveShipment = async (input: ShipmentInput) => {
    setIsSaving(true);
    setFormError(null);

    try {
      if (editingShipment) {
        const updatedShipment = await updateShipment(editingShipment.id, input);
        setShipments((current) => sortShipments(
          current.map((shipment) => (
            shipment.id === updatedShipment.id ? updatedShipment : shipment
          )),
        ));
        setNotice('Movimiento actualizado correctamente.');
      } else {
        const newShipment = await createShipment(input);
        setShipments((current) => sortShipments([...current, newShipment]));
        setNotice('Movimiento creado correctamente.');
      }

      void Promise.all([listZonesForShipments(), listZoneLocations()])
        .then(([zoneData, locationData]) => {
          setZones(zoneData);
          setZoneLocations(locationData);
        })
        .catch(() => undefined);

      if (canViewPricing) {
        void listCurrentShipmentPricingSummaries()
          .then(setPricingSummaries)
          .catch(() => undefined);
      }

      setIsFormOpen(false);
      setEditingShipment(null);
    } catch (caughtError: unknown) {
      setFormError(getErrorMessage(caughtError));
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteShipment(deleteTarget.id);
      setShipments((current) => current.filter((shipment) => shipment.id !== deleteTarget.id));
      setDeleteTarget(null);
      setNotice('Movimiento eliminado correctamente.');
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
          <h1 className="text-2xl font-bold text-slate-900">Movimientos</h1>
          <p className="mt-1 text-slate-500">Gestiona el flujo de paquetes de tu empresa.</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={openCreateForm}
            className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white shadow-sm shadow-[var(--color-primary)]/30 hover:bg-[var(--color-primary-hover)]"
          >
            <Plus size={18} /> Nuevo movimiento
          </button>
        )}
      </div>

      {notice && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <span>{notice}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            <X size={17} />
          </button>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ['Pendientes', shipments.filter((item) => item.status === 'pending').length, Package, 'text-amber-600 bg-amber-50'],
          ['En tránsito', shipments.filter((item) => item.status === 'in_transit').length, Truck, 'text-blue-600 bg-blue-50'],
          ['Entregados', shipments.filter((item) => item.status === 'delivered').length, CheckCircle2, 'text-emerald-600 bg-emerald-50'],
          ['Incidencias', shipments.filter((item) => item.status === 'incident').length, AlertCircle, 'text-red-600 bg-red-50'],
        ] as const).map(([label, value, Icon, classes]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${classes}`}>
              <Icon size={18} />
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-900">{isLoading ? '—' : value}</p>
            <p className="text-xs font-medium text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2 sm:col-span-2 lg:col-span-4">
          <Search size={20} className="ml-3 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por seguimiento, cliente, zona o dirección..."
            className="w-full bg-transparent py-2 text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>
        <label className="text-xs font-medium text-slate-600">
          Desde
          <input type="date" value={dateFromFilter} max={dateToFilter || undefined} onChange={(event) => setDateFromFilter(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Hasta
          <input type="date" value={dateToFilter} min={dateFromFilter || undefined} onChange={(event) => setDateToFilter(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ShipmentStatus | 'all')} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]">
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Zona
          <select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]">
            <option value="">Todas las zonas</option>
            {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Cliente
          <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]">
            <option value="">Todos los clientes</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{getClientDisplayName(client)}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">
          Ciudad destino
          <select value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]">
            <option value="">Todas las ciudades</option>
            {destinationOptions.map((destination) => <option key={destination.id} value={destination.id}>{destination.label}</option>)}
          </select>
        </label>
        <div className="flex items-end justify-end sm:col-span-2">
          <button type="button" disabled={!hasActiveFilters} onClick={resetListFilters} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
            <RotateCcw size={15} /> Limpiar filtros
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="flex animate-pulse gap-6 border-b border-slate-100 p-4 last:border-0">
              <div className="h-4 w-28 rounded bg-slate-100" />
              <div className="h-4 w-40 rounded bg-slate-100" />
              <div className="h-4 flex-1 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <AlertCircle size={36} className="mx-auto text-red-500" />
          <h2 className="mt-4 font-semibold text-slate-900">No pudimos cargar los movimientos</h2>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadMovementData()}
            className="mt-5 rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white hover:bg-[var(--color-primary-hover)]"
          >
            Reintentar
          </button>
        </div>
      ) : visibleShipments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Package size={42} className="mx-auto text-slate-300" />
          <h2 className="mt-4 font-semibold text-slate-900">
            {hasActiveFilters ? 'No encontramos movimientos' : 'Todavía no hay movimientos'}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {hasActiveFilters
              ? 'Cambia la búsqueda o el filtro seleccionado.'
              : 'Registra el primer paquete para comenzar a operar.'}
          </p>
          {!hasActiveFilters && canCreate && (
            <button
              type="button"
              onClick={openCreateForm}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white hover:bg-[var(--color-primary-hover)]"
            >
              <Plus size={17} /> Nuevo movimiento
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="p-4">Seguimiento</th>
                  <th className="p-4">Fecha</th>
                  <th className="p-4">Cliente</th>
                  <th className="p-4">Destino</th>
                  <th className="p-4">Zona</th>
                  <th className="p-4">Estado</th>
                  {canViewPricing && <th className="p-4 text-right">Total</th>}
                  {(canUpdate || canDelete) && <th className="p-4 text-right">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleShipments.map((shipment) => {
                  const client = shipment.client_id ? clientsById.get(shipment.client_id) : null;
                  const zone = shipment.zone_id ? zonesById.get(shipment.zone_id) : null;
                  const status = getStatusPresentation(shipment.status);
                  const pricing = pricingByShipmentId.get(shipment.id);

                  return (
                    <tr key={shipment.id} className="transition-colors hover:bg-slate-50/60">
                      <td className="p-4 font-mono text-sm font-semibold text-slate-900">{shipment.tracking_number}</td>
                      <td className="p-4 text-sm text-slate-600">
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <CalendarDays size={15} className="text-slate-400" />
                          {formatShipmentDate(shipment.shipment_date)}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {client ? getClientDisplayName(client) : 'Cliente no disponible'}
                      </td>
                      <td className="max-w-xs p-4 text-sm text-slate-600">
                        <span className="flex items-start gap-2">
                          <MapPin size={15} className="mt-0.5 shrink-0 text-slate-400" />
                          {shipment.delivery_address}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-slate-500">{zone?.name ?? 'Sin asignar'}</td>
                      <td className="p-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${status.classes}`}>
                          {status.label}
                        </span>
                      </td>
                      {canViewPricing && (
                        <td className="p-4 text-right text-sm font-semibold text-slate-700">
                          {pricing
                            ? <button type="button" onClick={() => setPricingHistoryTarget(shipment)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-slate-100 hover:text-[var(--color-primary)]" title="Ver historial económico"><ReceiptText size={14} />{new Intl.NumberFormat('es-AR', { style: 'currency', currency: pricing.currency }).format(pricing.customerTotal)}</button>
                            : <span className="font-normal text-slate-400">Sin valorar</span>}
                        </td>
                      )}
                      {(canUpdate || canDelete) && <td className="p-4">
                        <div className="flex justify-end gap-1">
                          {canUpdate && <button
                            type="button"
                            aria-label={`Editar ${shipment.tracking_number}`}
                            onClick={() => openEditForm(shipment)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-[var(--color-primary)]/5 hover:text-[var(--color-primary)]"
                          >
                            <Edit3 size={16} />
                          </button>}
                          {canDelete && <button
                            type="button"
                            aria-label={`Eliminar ${shipment.tracking_number}`}
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(shipment);
                            }}
                            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={16} />
                          </button>}
                        </div>
                      </td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isFormOpen && (
        <ShipmentFormModal
          key={editingShipment?.id ?? 'new-shipment'}
          shipment={editingShipment}
          clients={clients}
          zones={zones}
          zoneLocations={zoneLocations}
          isSaving={isSaving}
          error={formError}
          onClose={closeForm}
          onSubmit={saveShipment}
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
            <h2 className="mt-4 text-xl font-bold text-slate-900">Eliminar movimiento</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {deleteTarget.current_pricing_calculation_id
                ? <>El paquete <strong className="text-slate-700">{deleteTarget.tracking_number}</strong> posee historial económico y no puede eliminarse. Su cálculo debe conservarse para auditoría.</>
                : <>Se eliminará el paquete <strong className="text-slate-700">{deleteTarget.tracking_number}</strong>. Esta acción no se puede deshacer.</>}
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
              {!deleteTarget.current_pricing_calculation_id && (
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => void confirmDelete()}
                  className="rounded-xl bg-red-600 px-4 py-2.5 font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {isDeleting ? 'Eliminando...' : 'Eliminar movimiento'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {pricingHistoryTarget && (
        <ShipmentPricingHistoryModal
          shipment={pricingHistoryTarget}
          canManage={canManagePricing}
          onClose={() => setPricingHistoryTarget(null)}
          onAdjusted={() => {
            void listCurrentShipmentPricingSummaries()
              .then(setPricingSummaries)
              .catch(() => undefined);
          }}
        />
      )}
    </div>
  );
};

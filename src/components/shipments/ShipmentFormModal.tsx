import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Building2, Calculator, CalendarDays, CircleDollarSign, Hash, Layers3, MapPin, Package, RefreshCw, Sparkles, UserRound, X } from 'lucide-react';
import { CitySearch } from '../maps/CitySearch';
import { getClientDisplayName } from '../../services/clients';
import { listShipmentPricingOptions, previewShipmentPricing } from '../../services/shipments';
import type {
  ClientRecord,
  GeoPlace,
  PricingSimulationResult,
  ShipmentInput,
  ShipmentPricingOption,
  ShipmentRecord,
  ShipmentStatus,
  ZoneRecord,
  ZoneLocationRecord,
} from '../../types';

interface ShipmentFormModalProps {
  shipment: ShipmentRecord | null;
  clients: ClientRecord[];
  zones: ZoneRecord[];
  zoneLocations: ZoneLocationRecord[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: ShipmentInput) => Promise<void>;
}

const getLocalToday = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const matchesDestination = (
  placeId: string | null,
  name: string,
  latitude: number | null,
  longitude: number | null,
  destination: GeoPlace,
): boolean => {
  if (placeId === destination.placeId) return true;
  if (latitude === null || longitude === null) return false;
  return name.trim().toLocaleLowerCase('es-AR')
      === destination.name.trim().toLocaleLowerCase('es-AR')
    && Math.abs(latitude - destination.latitude) <= 0.05
    && Math.abs(longitude - destination.longitude) <= 0.05;
};

export const ShipmentFormModal = ({
  shipment,
  clients,
  zones,
  zoneLocations,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ShipmentFormModalProps) => {
  const [trackingNumber, setTrackingNumber] = useState(shipment?.tracking_number ?? '');
  const [shipmentDate, setShipmentDate] = useState(shipment?.shipment_date ?? getLocalToday());
  const [clientId, setClientId] = useState(shipment?.client_id ?? '');
  const [destination, setDestination] = useState<GeoPlace | null>(
    shipment?.destination_city
    && shipment.destination_place_id
    && shipment.destination_latitude !== null
    && shipment.destination_longitude !== null
      ? {
          name: shipment.destination_city,
          placeId: shipment.destination_place_id,
          label: shipment.destination_city,
          latitude: shipment.destination_latitude,
          longitude: shipment.destination_longitude,
        }
      : null,
  );
  const [deliveryAddress, setDeliveryAddress] = useState(shipment?.delivery_address ?? '');
  const [status, setStatus] = useState<ShipmentStatus>(shipment?.status ?? 'pending');
  const [rateCardId, setRateCardId] = useState(shipment?.selected_rate_card_id ?? '');
  const [packageCount, setPackageCount] = useState(shipment?.package_count ?? 1);
  const [weightKg, setWeightKg] = useState(shipment?.weight_kg ?? 0);
  const [volumeM3, setVolumeM3] = useState(shipment?.volume_m3 ?? 0);
  const [declaredValue, setDeclaredValue] = useState(shipment?.declared_value ?? 0);
  const [distanceKm, setDistanceKm] = useState(shipment?.distance_km ?? 0);
  const [isUrgent, setIsUrgent] = useState(shipment?.is_urgent ?? false);
  const [pricingOptions, setPricingOptions] = useState<ShipmentPricingOption[]>([]);
  const [pricingPreviewState, setPricingPreviewState] = useState<{
    fingerprint: string;
    result: PricingSimulationResult;
  } | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [isLoadingPricing, setIsLoadingPricing] = useState(true);
  const [isCalculatingPricing, setIsCalculatingPricing] = useState(false);

  const availableClients = clients.filter((client) => (
    client.status === 'active' || client.id === shipment?.client_id
  ));
  const matchingGroupLocation = destination
    ? zoneLocations.find((location) => location.location_type === 'city'
      && matchesDestination(
        location.mapbox_place_id,
        location.name,
        location.latitude,
        location.longitude,
        destination,
      ))
    : null;
  const resolvedZone = matchingGroupLocation
    ? zones.find((zone) => zone.id === matchingGroupLocation.group_zone_id) ?? null
    : destination
      ? zones.find((zone) => zone.zone_type === 'city'
        && matchesDestination(
          zone.mapbox_place_id,
          zone.name,
          zone.latitude,
          zone.longitude,
          destination,
        )) ?? null
      : null;

  const pricingFingerprint = [
    shipmentDate,
    clientId,
    destination?.placeId ?? '',
    resolvedZone?.id ?? '',
    rateCardId,
    packageCount,
    weightKg,
    volumeM3,
    declaredValue,
    distanceKm,
    isUrgent,
  ].join('|');
  const pricingPreview = pricingPreviewState?.fingerprint === pricingFingerprint
    ? pricingPreviewState.result
    : null;

  const pricingFormatter = useMemo(() => new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: pricingPreview?.currency ?? pricingOptions.find((option) => option.rateCardId === rateCardId)?.currency ?? 'ARS',
  }), [pricingOptions, pricingPreview?.currency, rateCardId]);

  useEffect(() => {
    let isCancelled = false;
    void listShipmentPricingOptions(shipmentDate)
      .then((options) => {
        if (isCancelled) return;
        setPricingOptions(options);
        setRateCardId((current) => {
          if (current && options.some((option) => option.rateCardId === current)) return current;
          return options.length === 1 ? options[0].rateCardId : '';
        });
      })
      .catch((caughtError: unknown) => {
        if (!isCancelled) {
          setPricingOptions([]);
          setPricingError(caughtError instanceof Error ? caughtError.message : 'No pudimos cargar las listas tarifarias.');
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingPricing(false);
      });
    return () => { isCancelled = true; };
  }, [shipmentDate]);

  const getFormInput = (): ShipmentInput | null => destination ? {
    trackingNumber,
    shipmentDate,
    clientId,
    deliveryAddress,
    status,
    destination,
    rateCardId,
    packageCount,
    weightKg,
    volumeM3,
    declaredValue,
    distanceKm,
    isUrgent,
  } : null;

  const calculatePricing = async () => {
    const input = getFormInput();
    if (!input || !input.clientId || !input.rateCardId) return;
    setIsCalculatingPricing(true);
    setPricingError(null);
    try {
      const fingerprint = pricingFingerprint;
      const result = await previewShipmentPricing(input, resolvedZone?.id ?? null);
      setPricingPreviewState({ fingerprint, result });
    } catch (caughtError: unknown) {
      setPricingError(caughtError instanceof Error ? caughtError.message : 'No pudimos calcular la tarifa.');
    } finally {
      setIsCalculatingPricing(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = getFormInput();
    if (!input) return;
    await onSubmit(input);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar formulario"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipment-form-title"
        className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="shipment-form-title" className="text-xl font-bold text-slate-900">
              {shipment ? 'Editar movimiento' : 'Nuevo movimiento'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Registra el paquete, su cliente y el destino de entrega.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="shipment-tracking" className="mb-1 block text-sm font-medium text-slate-700">
              Número de seguimiento
            </label>
            <div className="relative">
              <Hash size={18} className="absolute left-3 top-3.5 text-slate-400" />
              <input
                id="shipment-tracking"
                required
                minLength={3}
                maxLength={64}
                autoFocus
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value.toUpperCase())}
                placeholder="PKG-00001"
                className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 font-mono uppercase outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
              />
            </div>
          </div>

          <div>
            <label htmlFor="shipment-date" className="mb-1 block text-sm font-medium text-slate-700">
              Fecha del registro
            </label>
            <div className="relative">
              <CalendarDays size={18} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
              <input
                id="shipment-date"
                required
                type="date"
                value={shipmentDate}
                onChange={(event) => {
                  setIsLoadingPricing(true);
                  setPricingError(null);
                  setShipmentDate(event.target.value);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
              />
            </div>
          </div>

          <div>
            <label htmlFor="shipment-client" className="mb-1 block text-sm font-medium text-slate-700">
              Cliente
            </label>
            <div className="relative">
              <UserRound size={18} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
              <select
                id="shipment-client"
                required
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
              >
                <option value="">Seleccionar cliente</option>
                {availableClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {getClientDisplayName(client)}
                    {client.status === 'inactive' ? ' (inactivo)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <CitySearch selectedPlace={destination} required onSelect={setDestination} placeholder="Buscar ciudad de destino..." />
            {destination && (
              <div className={`mt-2 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${resolvedZone ? 'bg-emerald-50 text-emerald-800' : 'bg-violet-50 text-violet-800'}`}>
                {resolvedZone?.zone_type === 'group' ? <Layers3 size={16} className="mt-0.5 shrink-0" /> : resolvedZone ? <Building2 size={16} className="mt-0.5 shrink-0" /> : <Sparkles size={16} className="mt-0.5 shrink-0" />}
                <span>{resolvedZone ? <>Se asignará a <strong>{resolvedZone.name}</strong> ({resolvedZone.zone_type === 'group' ? 'grupo' : 'ciudad individual'}).</> : <>No existe cobertura previa: <strong>{destination.name}</strong> se creará como ciudad individual.</>}</span>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="shipment-address" className="mb-1 block text-sm font-medium text-slate-700">
              Dirección de entrega
            </label>
            <div className="relative">
              <MapPin size={18} className="absolute left-3 top-3.5 text-slate-400" />
              <input
                id="shipment-address"
                required
                maxLength={240}
                value={deliveryAddress}
                onChange={(event) => setDeliveryAddress(event.target.value)}
                placeholder="Av. Siempre Viva 123, CABA"
                className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
              />
            </div>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-[var(--color-primary)]">
                <CircleDollarSign size={19} />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">Valor económico</h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Selecciona una lista publicada para guardar un cálculo auditable. Es opcional.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Lista tarifaria vigente
                <select
                  value={rateCardId}
                  disabled={isLoadingPricing}
                  onChange={(event) => { setRateCardId(event.target.value); setPricingError(null); }}
                  className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                >
                  <option value="">Sin valoración económica</option>
                  {pricingOptions.map((option) => (
                    <option key={option.rateCardId} value={option.rateCardId}>
                      {option.rateCardName} · v{option.versionNumber} · {option.currency}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-medium text-slate-600">
                Cantidad de paquetes
                <input required type="number" min={1} max={1000000} step={1} value={packageCount} onChange={(event) => setPackageCount(Number(event.target.value))} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Peso total (kg)
                <input type="number" min={0} step="0.001" value={weightKg} onChange={(event) => setWeightKg(Number(event.target.value))} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Volumen total (m³)
                <input type="number" min={0} step="0.0001" value={volumeM3} onChange={(event) => setVolumeM3(Number(event.target.value))} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Valor declarado
                <input type="number" min={0} step="0.01" value={declaredValue} onChange={(event) => setDeclaredValue(Number(event.target.value))} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Distancia estimada (km)
                <input type="number" min={0} step="0.001" value={distanceKm} onChange={(event) => setDistanceKm(Number(event.target.value))} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
              </label>
              <label className="flex items-center gap-2 self-end rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
                <input type="checkbox" checked={isUrgent} onChange={(event) => setIsUrgent(event.target.checked)} />
                Servicio urgente
              </label>
            </div>

            {pricingError && <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs text-red-700">{pricingError}</div>}

            {rateCardId && (
              <div className="mt-4">
                <button
                  type="button"
                  disabled={isCalculatingPricing || !clientId || !destination}
                  onClick={() => void calculatePricing()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-primary)] disabled:opacity-50"
                >
                  {isCalculatingPricing ? <RefreshCw size={16} className="animate-spin" /> : <Calculator size={16} />}
                  {isCalculatingPricing ? 'Calculando...' : 'Previsualizar tarifa'}
                </button>

                {pricingPreview && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-end justify-between gap-3 border-b border-slate-100 pb-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total al cliente</p>
                        <p className="mt-1 text-2xl font-bold text-slate-900">{pricingFormatter.format(pricingPreview.customerTotal)}</p>
                        <p className="mt-1 text-[10px] text-slate-500">Impuestos identificados: {pricingFormatter.format(pricingPreview.taxTotal)}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500">v{pricingPreview.versionNumber}</span>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {pricingPreview.lineItems.map((line) => (
                        <div key={line.ruleId} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate text-slate-500">{line.ruleName}{line.taxBehavior !== 'none' ? ` · ${line.taxLabel} ${line.taxRate}%` : ''}</span>
                          <strong className={line.amount < 0 ? 'text-emerald-600' : 'text-slate-700'}>{pricingFormatter.format(line.amount)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <div>
            <label htmlFor="shipment-status" className="mb-1 block text-sm font-medium text-slate-700">
              Estado
            </label>
            <div className="relative">
              <Package size={18} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
              <select
                id="shipment-status"
                value={status}
                onChange={(event) => setStatus(event.target.value as ShipmentStatus)}
                className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
              >
                <option value="pending">Pendiente</option>
                <option value="in_transit">En tránsito</option>
                <option value="delivered">Entregado</option>
                <option value="incident">Incidencia</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-xl border border-slate-200 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              disabled={isSaving || availableClients.length === 0 || !destination}
              className="rounded-xl bg-[var(--color-primary)] px-5 py-2.5 font-medium text-white shadow-sm shadow-[var(--color-primary)]/20 hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Guardando...' : shipment ? 'Guardar cambios' : 'Crear movimiento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

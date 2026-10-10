import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Edit3,
  Layers3,
  Map as MapIcon,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { ZoneFormModal } from '../components/zones/ZoneFormModal';
import { OPENSTREETMAP_ATTRIBUTION, OPENSTREETMAP_TILE_URL } from '../config/maps';
import { getZoneColorHex } from '../config/zones';
import { getErrorMessage } from '../services/auth';
import { deleteZone, listZoneLocations, listZones, saveZone as persistZone } from '../services/zones';
import type { ZoneInput, ZoneLocationRecord, ZoneRecord } from '../types';

interface ZonesPageProps {
  canManage: boolean;
  mapDefaults: {
    latitude: number;
    longitude: number;
    zoom: number;
  };
}

interface MapFocus {
  latitude: number;
  longitude: number;
  zoom: number;
}

const MapFocusController = ({ focus }: { focus: MapFocus | null }) => {
  const map = useMap();

  useEffect(() => {
    if (focus) {
      map.flyTo([focus.latitude, focus.longitude], focus.zoom, {
        animate: true,
        duration: 0.5,
      });
    }
  }, [focus, map]);

  return null;
};

export const ZonesPage = ({ canManage, mapDefaults }: ZonesPageProps) => {
  const [zones, setZones] = useState<ZoneRecord[]>([]);
  const [locations, setLocations] = useState<ZoneLocationRecord[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<ZoneRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ZoneRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshZones = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [zoneData, locationData] = await Promise.all([listZones(), listZoneLocations()]);
      setZones(zoneData);
      setLocations(locationData);
    } catch (caughtError: unknown) {
      setLoadError(getErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadInitialZones = async () => {
      try {
        const [initialZones, initialLocations] = await Promise.all([
          listZones(),
          listZoneLocations(),
        ]);
        if (!isCancelled) {
          setZones(initialZones);
          setLocations(initialLocations);
        }
      } catch (caughtError: unknown) {
        if (!isCancelled) setLoadError(getErrorMessage(caughtError));
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    void loadInitialZones();
    return () => {
      isCancelled = true;
    };
  }, []);

  const visibleZones = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es');
    return query
      ? zones.filter((zone) => zone.name.toLocaleLowerCase('es').includes(query)
        || locations.some((location) => location.group_zone_id === zone.id
          && location.name.toLocaleLowerCase('es').includes(query)))
      : zones;
  }, [locations, search, zones]);

  const openCreateForm = () => {
    setEditingZone(null);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (zone: ZoneRecord) => {
    setEditingZone(zone);
    setFormError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (isSaving) return;
    setIsFormOpen(false);
    setEditingZone(null);
    setFormError(null);
  };

  const saveZone = async (input: ZoneInput) => {
    setIsSaving(true);
    setFormError(null);

    try {
      if (editingZone) {
        const updatedZone = await persistZone(editingZone.id, input);
        setZones((current) => current
          .map((zone) => zone.id === updatedZone.id ? updatedZone : zone)
          .sort((first, second) => first.name.localeCompare(second.name, 'es')));
        setNotice('Zona actualizada correctamente.');
      } else {
        const newZone = await persistZone(null, input);
        setZones((current) => [...current, newZone]
          .sort((first, second) => first.name.localeCompare(second.name, 'es')));
        setNotice('Zona creada correctamente.');
      }

      void listZoneLocations()
        .then(setLocations)
        .catch(() => setNotice('La zona se guardó, pero debes recargar para ver sus ubicaciones.'));

      setIsFormOpen(false);
      setEditingZone(null);
    } catch (caughtError: unknown) {
      setFormError(getErrorMessage(caughtError));
    } finally {
      setIsSaving(false);
    }
  };

  const focusZone = (zone: ZoneRecord) => {
    const zoneLocations = locations.filter((location) => location.group_zone_id === zone.id);
    const latitude = zone.latitude ?? zoneLocations[0]?.latitude;
    const longitude = zone.longitude ?? zoneLocations[0]?.longitude;
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) return;
    setMapFocus({ latitude, longitude, zoom: 12 });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteZone(deleteTarget.id);
      setZones((current) => current.filter((zone) => zone.id !== deleteTarget.id));
      setLocations((current) => current.filter((location) => location.group_zone_id !== deleteTarget.id));
      setDeleteTarget(null);
      setNotice('Zona eliminada correctamente.');
    } catch (caughtError: unknown) {
      setDeleteError(getErrorMessage(caughtError));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Zonas y rutas</h1>
          <p className="mt-1 text-slate-500">Organiza ciudades y puntos dentro de tu cobertura logística.</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreateForm}
            className="flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white hover:bg-[var(--color-primary-hover)]"
          >
            <Plus size={18} /> Nueva zona
          </button>
        )}
      </div>

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            <X size={17} />
          </button>
        </div>
      )}

      {!canManage && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Puedes consultar las zonas. Tu rol no permite configurarlas.
        </div>
      )}

      {loadError ? (
        <div className="rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <AlertCircle size={36} className="mx-auto text-red-500" />
          <h2 className="mt-4 font-semibold text-slate-900">No pudimos cargar las zonas</h2>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
          <button
            type="button"
            onClick={() => void refreshZones()}
            className="mt-5 rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white hover:bg-[var(--color-primary-hover)]"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div className="grid min-h-[600px] flex-1 grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-1">
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
              <Search size={20} className="ml-3 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar zona..."
                className="w-full bg-transparent py-2 text-slate-700 outline-none"
              />
            </div>

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
              {isLoading ? (
                [1, 2, 3].map((item) => (
                  <div key={item} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="h-4 w-1/2 rounded bg-slate-100" />
                    <div className="mt-4 h-3 w-2/3 rounded bg-slate-100" />
                  </div>
                ))
              ) : visibleZones.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <MapPin size={36} className="mx-auto text-slate-300" />
                  <h2 className="mt-3 font-semibold text-slate-900">
                    {search ? 'No hay coincidencias' : 'Todavía no hay zonas'}
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    {search ? 'Prueba con otro nombre.' : 'Crea una zona para ubicarla en el mapa.'}
                  </p>
                  {canManage && !search && (
                    <button
                      type="button"
                      onClick={openCreateForm}
                      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white"
                    >
                      <Plus size={16} /> Nueva zona
                    </button>
                  )}
                </div>
              ) : visibleZones.map((zone) => {
                const color = getZoneColorHex(zone.color);
                const zoneLocations = locations.filter((location) => location.group_zone_id === zone.id);
                const hasCoordinates = (zone.latitude !== null && zone.longitude !== null)
                  || zoneLocations.length > 0;
                const TypeIcon = zone.zone_type === 'group' ? Layers3 : Building2;

                return (
                  <article
                    key={zone.id}
                    onClick={() => focusZone(zone)}
                    className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${
                      hasCoordinates ? 'cursor-pointer' : ''
                    }`}
                  >
                    <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} />
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-bold text-slate-900">{zone.name}</h2>
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                            <TypeIcon size={11} /> {zone.zone_type === 'group' ? 'Grupo' : 'Ciudad'}
                          </span>
                        </div>
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                          <MapPin size={14} style={{ color }} />
                          {zone.zone_type === 'group'
                            ? `${zoneLocations.length} ${zoneLocations.length === 1 ? 'ubicación' : 'ubicaciones'}`
                            : hasCoordinates
                            ? `${zone.latitude?.toFixed(5)}, ${zone.longitude?.toFixed(5)}`
                            : 'Sin ubicación configurada'}
                        </p>
                        {zone.zone_type === 'group' && zoneLocations.length > 0 && (
                          <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                            {zoneLocations.map((location) => location.name).join(' · ')}
                          </p>
                        )}
                      </div>
                      {canManage && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            aria-label={`Editar ${zone.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditForm(zone);
                            }}
                            className="rounded-lg p-2 text-slate-400 hover:bg-[var(--color-primary)]/5 hover:text-[var(--color-primary)]"
                          >
                            <Edit3 size={16} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Eliminar ${zone.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteError(null);
                              setDeleteTarget(zone);
                            }}
                            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-4">
              <h2 className="flex items-center gap-2 font-semibold text-slate-800">
                <MapIcon size={18} className="text-[var(--color-primary)]" /> Visor geográfico
              </h2>
              <span className="text-xs text-slate-400">OpenStreetMap · sin claves</span>
            </div>

            <div className="h-[calc(100%-65px)] min-h-[530px]">
              <MapContainer
                center={[mapDefaults.latitude, mapDefaults.longitude]}
                zoom={mapDefaults.zoom}
                minZoom={3}
                maxZoom={19}
                scrollWheelZoom
                className="h-full w-full"
              >
                  <TileLayer
                    attribution={OPENSTREETMAP_ATTRIBUTION}
                    url={OPENSTREETMAP_TILE_URL}
                    maxZoom={19}
                  />
                  <MapFocusController focus={mapFocus} />
                  {zones.map((zone) => (
                    zone.zone_type === 'city' && zone.latitude !== null && zone.longitude !== null && (
                      <CircleMarker
                        key={zone.id}
                        center={[zone.latitude, zone.longitude]}
                        radius={10}
                        pathOptions={{ color: '#ffffff', weight: 3, fillColor: getZoneColorHex(zone.color), fillOpacity: 1 }}
                        eventHandlers={{ click: () => focusZone(zone) }}
                      >
                        <Tooltip>{zone.name} · Ciudad</Tooltip>
                      </CircleMarker>
                    )
                  ))}
                  {locations.map((location) => {
                    const group = zones.find((zone) => zone.id === location.group_zone_id);
                    if (!group) return null;
                    return (
                      <CircleMarker
                        key={location.id}
                        center={[location.latitude, location.longitude]}
                        radius={location.location_type === 'custom' ? 7 : 9}
                        pathOptions={{ color: '#ffffff', weight: 2, fillColor: getZoneColorHex(group.color), fillOpacity: 1 }}
                        eventHandlers={{ click: () => focusZone(group) }}
                      >
                        <Tooltip>{location.name} · {group.name}</Tooltip>
                      </CircleMarker>
                    );
                  })}
              </MapContainer>
            </div>
          </div>
        </div>
      )}

      {isFormOpen && (
        <ZoneFormModal
          key={editingZone?.id ?? 'new-zone'}
          zone={editingZone}
          locations={locations.filter((location) => location.group_zone_id === editingZone?.id)}
          mapDefaults={mapDefaults}
          isSaving={isSaving}
          error={formError}
          onClose={closeForm}
          onSubmit={saveZone}
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
            <h2 className="mt-4 text-xl font-bold text-slate-900">Eliminar zona</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Se eliminará <strong className="text-slate-700">{deleteTarget.name}</strong>. Si tiene movimientos asociados, Supabase impedirá la eliminación.
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
                {isDeleting ? 'Eliminando...' : 'Eliminar zona'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

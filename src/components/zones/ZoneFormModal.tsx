import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { Building2, Layers3, MapPin, Plus, Trash2, X } from 'lucide-react';
import { CitySearch } from '../maps/CitySearch';
import { OPENSTREETMAP_ATTRIBUTION, OPENSTREETMAP_TILE_URL } from '../../config/maps';
import { getZoneColorHex, ZONE_COLOR_OPTIONS } from '../../config/zones';
import type {
  GeoPlace,
  ZoneColor,
  ZoneInput,
  ZoneLocationInput,
  ZoneLocationRecord,
  ZoneLocationType,
  ZoneRecord,
  ZoneType,
} from '../../types';

interface ZoneFormModalProps {
  zone: ZoneRecord | null;
  locations: ZoneLocationRecord[];
  mapDefaults: {
    latitude: number;
    longitude: number;
    zoom: number;
  };
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: ZoneInput) => Promise<void>;
}

const toPlace = (zone: ZoneRecord | null): GeoPlace | null => (
  zone?.zone_type === 'city'
  && zone.mapbox_place_id
  && zone.latitude !== null
  && zone.longitude !== null
    ? {
        placeId: zone.mapbox_place_id,
        name: zone.name,
        label: zone.place_label ?? zone.name,
        latitude: zone.latitude,
        longitude: zone.longitude,
      }
    : null
);

const toLocationInput = (location: ZoneLocationRecord): ZoneLocationInput => ({
  locationType: location.location_type,
  name: location.name,
  placeId: location.mapbox_place_id ?? '',
  placeLabel: location.place_label ?? '',
  latitude: location.latitude,
  longitude: location.longitude,
});

interface MapInteractionControllerProps {
  latitude: number;
  longitude: number;
  zoom: number;
  onMapClick: (latitude: number, longitude: number) => void;
}

const MapInteractionController = ({ latitude, longitude, zoom, onMapClick }: MapInteractionControllerProps) => {
  const map = useMap();

  useEffect(() => {
    map.flyTo([latitude, longitude], zoom, { animate: true, duration: 0.5 });
  }, [latitude, longitude, map, zoom]);

  useMapEvents({
    click: (event) => onMapClick(event.latlng.lat, event.latlng.lng),
  });

  return null;
};

export const ZoneFormModal = ({
  zone,
  locations,
  mapDefaults,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ZoneFormModalProps) => {
  const [zoneType, setZoneType] = useState<ZoneType>(zone?.zone_type ?? 'city');
  const [name, setName] = useState(zone?.name ?? '');
  const [selectedCity, setSelectedCity] = useState<GeoPlace | null>(toPlace(zone));
  const [latitude, setLatitude] = useState(
    zone?.latitude?.toString() ?? mapDefaults.latitude.toString(),
  );
  const [longitude, setLongitude] = useState(
    zone?.longitude?.toString() ?? mapDefaults.longitude.toString(),
  );
  const [color, setColor] = useState<ZoneColor>(zone?.color ?? 'violet');
  const [members, setMembers] = useState<ZoneLocationInput[]>(locations.map(toLocationInput));
  const [memberType, setMemberType] = useState<ZoneLocationType>('city');
  const [memberCity, setMemberCity] = useState<GeoPlace | null>(null);
  const [customName, setCustomName] = useState('');
  const [customLatitude, setCustomLatitude] = useState(mapDefaults.latitude.toString());
  const [customLongitude, setCustomLongitude] = useState(mapDefaults.longitude.toString());

  const numericLatitude = Number(latitude);
  const numericLongitude = Number(longitude);
  const hasValidCoordinates = Number.isFinite(numericLatitude)
    && Number.isFinite(numericLongitude)
    && numericLatitude >= -90
    && numericLatitude <= 90
    && numericLongitude >= -180
    && numericLongitude <= 180;
  const numericCustomLatitude = Number(customLatitude);
  const numericCustomLongitude = Number(customLongitude);
  const hasValidCustomCoordinates = Number.isFinite(numericCustomLatitude)
    && Number.isFinite(numericCustomLongitude)
    && numericCustomLatitude >= -90
    && numericCustomLatitude <= 90
    && numericCustomLongitude >= -180
    && numericCustomLongitude <= 180;

  const mapCenter = useMemo(() => {
    if (zoneType === 'city' && hasValidCoordinates) {
      return { latitude: numericLatitude, longitude: numericLongitude };
    }
    if (members[0]) {
      return { latitude: members[0].latitude, longitude: members[0].longitude };
    }
    return { latitude: mapDefaults.latitude, longitude: mapDefaults.longitude };
  }, [
    hasValidCoordinates,
    mapDefaults.latitude,
    mapDefaults.longitude,
    members,
    numericLatitude,
    numericLongitude,
    zoneType,
  ]);

  const addMember = () => {
    const location: ZoneLocationInput | null = memberType === 'city'
      ? memberCity && {
          locationType: 'city',
          name: memberCity.name,
          placeId: memberCity.placeId,
          placeLabel: memberCity.label,
          latitude: memberCity.latitude,
          longitude: memberCity.longitude,
        }
      : customName.trim().length >= 2 && hasValidCustomCoordinates
        ? {
            locationType: 'custom',
            name: customName.trim(),
            placeId: '',
            placeLabel: '',
            latitude: numericCustomLatitude,
            longitude: numericCustomLongitude,
          }
        : null;

    if (!location) return;
    const duplicate = members.some((member) => (
      location.placeId
        ? member.placeId === location.placeId
        : member.locationType === location.locationType
          && member.name.toLocaleLowerCase('es') === location.name.toLocaleLowerCase('es')
    ));
    if (duplicate) return;

    setMembers((current) => [...current, location]);
    setMemberCity(null);
    setCustomName('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (zoneType === 'city' && (!selectedCity || !hasValidCoordinates)) return;

    await onSubmit({
      name,
      zoneType,
      latitude: zoneType === 'city' ? numericLatitude : null,
      longitude: zoneType === 'city' ? numericLongitude : null,
      color,
      placeId: zoneType === 'city' ? selectedCity?.placeId ?? '' : '',
      placeLabel: zoneType === 'city' ? selectedCity?.label ?? '' : '',
      locations: zoneType === 'group' ? members : [],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cerrar formulario" onClick={onClose} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" aria-labelledby="zone-form-title" className="relative max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="zone-form-title" className="text-xl font-bold text-slate-900">{zone ? 'Editar zona' : 'Nueva zona'}</h2>
            <p className="mt-1 text-sm text-slate-500">Crea una ciudad individual o agrupa varios destinos logísticos.</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} disabled={isSaving} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={20} /></button>
        </div>

        {error && <div className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Tipo de zona</legend>
            <div className="grid grid-cols-2 gap-3">
              {([
                ['city', 'Ciudad', 'Destino individual geocodificado', Building2],
                ['group', 'Grupo', 'Conjunto de ciudades y puntos', Layers3],
              ] as const).map(([value, label, description, Icon]) => (
                <button key={value} type="button" aria-pressed={zoneType === value} onClick={() => setZoneType(value)} className={`flex items-center gap-3 rounded-xl border p-3 text-left ${zoneType === value ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  <Icon size={21} />
                  <span><span className="block text-sm font-semibold">{label}</span><span className="block text-xs opacity-70">{description}</span></span>
                </button>
              ))}
            </div>
          </fieldset>

          {zoneType === 'city' ? (
            <>
              <CitySearch selectedPlace={selectedCity} required onSelect={(place) => {
                setSelectedCity(place);
                if (!place) return;
                setName(place.name);
                setLatitude(place.latitude.toFixed(6));
                setLongitude(place.longitude.toFixed(6));
              }} />
              <div>
                <label htmlFor="zone-name" className="mb-1 block text-sm font-medium text-slate-700">Nombre visible</label>
                <input id="zone-name" required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="La Plata" className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="zone-name" className="mb-1 block text-sm font-medium text-slate-700">Nombre del grupo</label>
                <input id="zone-name" required minLength={2} maxLength={120} autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="AMBA Norte" className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20" />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><h3 className="font-semibold text-slate-800">Ubicaciones del grupo</h3><p className="text-xs text-slate-500">Las ciudades asignarán automáticamente sus pedidos a este grupo.</p></div>
                  <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-xs font-medium">
                    <button type="button" onClick={() => setMemberType('city')} className={`rounded-md px-3 py-1.5 ${memberType === 'city' ? 'bg-[var(--color-primary)] text-white' : 'text-slate-500'}`}>Ciudad</button>
                    <button type="button" onClick={() => setMemberType('custom')} className={`rounded-md px-3 py-1.5 ${memberType === 'custom' ? 'bg-[var(--color-primary)] text-white' : 'text-slate-500'}`}>Punto personalizado</button>
                  </div>
                </div>

                <div className="mt-4">
                  {memberType === 'city' ? (
                    <CitySearch selectedPlace={memberCity} onSelect={setMemberCity} placeholder="Buscar ciudad para agregar..." />
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <input aria-label="Nombre del punto" value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Depósito Pilar" className="rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[var(--color-primary)]" />
                      <input aria-label="Latitud del punto" type="number" step="any" min="-90" max="90" value={customLatitude} onChange={(event) => setCustomLatitude(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 font-mono outline-none focus:border-[var(--color-primary)]" />
                      <input aria-label="Longitud del punto" type="number" step="any" min="-180" max="180" value={customLongitude} onChange={(event) => setCustomLongitude(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 font-mono outline-none focus:border-[var(--color-primary)]" />
                    </div>
                  )}
                  <button type="button" disabled={memberType === 'city' ? !memberCity : customName.trim().length < 2 || !hasValidCustomCoordinates} onClick={addMember} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"><Plus size={16} /> Agregar al grupo</button>
                </div>

                <div className="mt-4 space-y-2">
                  {members.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-400">Aún no agregaste ubicaciones.</p> : members.map((member, index) => (
                    <div key={`${member.locationType}-${member.placeId || member.name}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2"><MapPin size={16} style={{ color: getZoneColorHex(color) }} /><span className="truncate text-sm font-medium text-slate-700">{member.name}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase text-slate-500">{member.locationType === 'city' ? 'Ciudad' : 'Punto'}</span></span>
                      <button type="button" aria-label={`Quitar ${member.name}`} onClick={() => setMembers((current) => current.filter((_, currentIndex) => currentIndex !== index))} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Color del marcador</legend>
            <div className="flex flex-wrap gap-2">{ZONE_COLOR_OPTIONS.map((option) => (
              <button key={option.value} type="button" aria-label={option.label} aria-pressed={color === option.value} onClick={() => setColor(option.value)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${color === option.value ? 'border-slate-400 bg-slate-50 font-semibold text-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}><span className="h-3 w-3 rounded-full" style={{ backgroundColor: option.hex }} />{option.label}</button>
            ))}</div>
          </fieldset>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-medium text-slate-700">Ubicación exacta</span><span className="text-xs text-slate-400">{zoneType === 'city' ? 'Haz clic para ajustar el punto de la ciudad' : memberType === 'custom' ? 'Haz clic para posicionar el nuevo punto' : 'Vista de las ubicaciones agrupadas'}</span></div>
            <div className="h-72 overflow-hidden rounded-2xl border border-slate-200">
              <MapContainer
                center={[mapCenter.latitude, mapCenter.longitude]}
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
                <MapInteractionController
                  latitude={mapCenter.latitude}
                  longitude={mapCenter.longitude}
                  zoom={10}
                  onMapClick={(nextLatitude, nextLongitude) => {
                    if (zoneType === 'city') {
                      setLongitude(nextLongitude.toFixed(6));
                      setLatitude(nextLatitude.toFixed(6));
                    } else if (memberType === 'custom') {
                      setCustomLongitude(nextLongitude.toFixed(6));
                      setCustomLatitude(nextLatitude.toFixed(6));
                    }
                  }}
                />
                {zoneType === 'city' && hasValidCoordinates && (
                  <CircleMarker center={[numericLatitude, numericLongitude]} radius={10} pathOptions={{ color: '#ffffff', weight: 3, fillColor: getZoneColorHex(color), fillOpacity: 1 }}>
                    <Tooltip>{name || 'Ciudad seleccionada'}</Tooltip>
                  </CircleMarker>
                )}
                {zoneType === 'group' && members.map((member, index) => (
                  <CircleMarker key={`${member.name}-${index}`} center={[member.latitude, member.longitude]} radius={8} pathOptions={{ color: '#ffffff', weight: 2, fillColor: getZoneColorHex(color), fillOpacity: 1 }}>
                    <Tooltip>{member.name}</Tooltip>
                  </CircleMarker>
                ))}
                {zoneType === 'group' && memberType === 'custom' && hasValidCustomCoordinates && (
                  <CircleMarker center={[numericCustomLatitude, numericCustomLongitude]} radius={9} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#0f172a', fillOpacity: 1 }}>
                    <Tooltip>{customName || 'Nuevo punto'}</Tooltip>
                  </CircleMarker>
                )}
              </MapContainer>
            </div>
          </div>

          {zoneType === 'city' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><label htmlFor="zone-latitude" className="mb-1 block text-sm font-medium text-slate-700">Latitud</label><input id="zone-latitude" required type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 font-mono outline-none focus:border-[var(--color-primary)]" /></div>
              <div><label htmlFor="zone-longitude" className="mb-1 block text-sm font-medium text-slate-700">Longitud</label><input id="zone-longitude" required type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 font-mono outline-none focus:border-[var(--color-primary)]" /></div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={isSaving} className="rounded-xl border border-slate-200 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cancelar</button>
            <button disabled={isSaving || (zoneType === 'city' && (!selectedCity || !hasValidCoordinates))} className="rounded-xl bg-[var(--color-primary)] px-5 py-2.5 font-medium text-white shadow-sm shadow-[var(--color-primary)]/20 hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60">{isSaving ? 'Guardando...' : zone ? 'Guardar cambios' : 'Crear zona'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

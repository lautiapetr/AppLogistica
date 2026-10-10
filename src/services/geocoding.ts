import type { GeoPlace } from '../types';
import { NOMINATIM_BASE_URL } from '../config/maps';

type NominatimResult = {
  place_id?: number | string;
  osm_type?: string;
  osm_id?: number | string;
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  addresstype?: string;
  type?: string;
  address?: Record<string, string | undefined>;
};

type CachedSearch = {
  savedAt: number;
  places: GeoPlace[];
};

const CACHE_PREFIX = 'applogistica:osm-city-search:';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CITY_TYPES = new Set([
  'city',
  'town',
  'village',
  'municipality',
  'locality',
  'administrative',
]);

let nextAllowedRequestAt = 0;

const asText = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

const normalizeQuery = (query: string): string => (
  query.trim().toLocaleLowerCase('es-AR').replace(/\s+/g, ' ')
);

const getCachedSearch = (query: string): GeoPlace[] | null => {
  try {
    const serialized = window.localStorage.getItem(`${CACHE_PREFIX}${query}`);
    if (!serialized) return null;
    const cached = JSON.parse(serialized) as CachedSearch;
    if (!Array.isArray(cached.places) || Date.now() - cached.savedAt > CACHE_TTL_MS) {
      window.localStorage.removeItem(`${CACHE_PREFIX}${query}`);
      return null;
    }
    return cached.places;
  } catch {
    return null;
  }
};

const cacheSearch = (query: string, places: GeoPlace[]) => {
  try {
    window.localStorage.setItem(
      `${CACHE_PREFIX}${query}`,
      JSON.stringify({ savedAt: Date.now(), places } satisfies CachedSearch),
    );
  } catch {
    // Private browsing or a full storage quota must not break city selection.
  }
};

const waitForRateLimit = async (signal?: AbortSignal) => {
  const delay = Math.max(0, nextAllowedRequestAt - Date.now());
  if (delay > 0) {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(resolve, delay);
      signal?.addEventListener('abort', () => {
        window.clearTimeout(timeout);
        reject(new DOMException('La búsqueda fue cancelada.', 'AbortError'));
      }, { once: true });
    });
  }
  nextAllowedRequestAt = Date.now() + 1_100;
};

const parseResult = (result: NominatimResult): GeoPlace | null => {
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  const osmType = asText(result.osm_type);
  const osmId = result.osm_id === undefined ? null : String(result.osm_id);
  const fallbackId = result.place_id === undefined ? null : String(result.place_id);
  const address = result.address ?? {};
  const name = asText(result.name)
    ?? asText(address.city)
    ?? asText(address.town)
    ?? asText(address.village)
    ?? asText(address.municipality)
    ?? asText(address.locality);
  const label = asText(result.display_name);

  if (!name || !label || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const placeId = osmType && osmId
    ? `osm:${osmType}:${osmId}`
    : fallbackId && `osm:place:${fallbackId}`;
  if (!placeId) return null;

  return { placeId, name, label, latitude, longitude };
};

export const searchCities = async (
  query: string,
  signal?: AbortSignal,
): Promise<GeoPlace[]> => {
  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery.length < 2) return [];

  const cached = getCachedSearch(normalizedQuery);
  if (cached) return cached;

  await waitForRateLimit(signal);

  const parameters = new URLSearchParams({
    q: normalizedQuery,
    format: 'jsonv2',
    addressdetails: '1',
    countrycodes: 'ar',
    layer: 'address',
    limit: '10',
    'accept-language': 'es-AR,es',
  });
  const response = await fetch(`${NOMINATIM_BASE_URL}/search?${parameters.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error('No se pudo consultar OpenStreetMap. Intenta nuevamente en unos segundos.');
  }

  const body = await response.json() as NominatimResult[];
  const places = body
    .filter((result) => CITY_TYPES.has(result.addresstype ?? result.type ?? ''))
    .map(parseResult)
    .filter((place): place is GeoPlace => place !== null)
    .slice(0, 6);

  cacheSearch(normalizedQuery, places);
  return places;
};

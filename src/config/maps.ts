export const OPENSTREETMAP_TILE_URL = import.meta.env.VITE_OSM_TILE_URL
  ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const OPENSTREETMAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const NOMINATIM_BASE_URL = import.meta.env.VITE_NOMINATIM_URL
  ?? 'https://nominatim.openstreetmap.org';

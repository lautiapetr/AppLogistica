import { supabase } from '../config/supabase';
import type { Json, ZoneInput, ZoneLocationRecord, ZoneRecord } from '../types';

const ZONE_FIELDS = 'id, company_id, name, latitude, longitude, color, zone_type, mapbox_place_id, place_label' as const;
const LOCATION_FIELDS = 'id, company_id, group_zone_id, location_type, name, mapbox_place_id, place_label, latitude, longitude' as const;

const toLocationsPayload = (input: ZoneInput): Json => input.locations.map((location) => ({
  location_type: location.locationType,
  name: location.name.trim(),
  // Database column name is legacy; values are provider-neutral place IDs.
  mapbox_place_id: location.placeId.trim() || null,
  place_label: location.placeLabel.trim() || null,
  latitude: location.latitude,
  longitude: location.longitude,
}));

export const listZones = async (): Promise<ZoneRecord[]> => {
  const { data, error } = await supabase
    .from('zones')
    .select(ZONE_FIELDS)
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
};

export const listZoneLocations = async (): Promise<ZoneLocationRecord[]> => {
  const { data, error } = await supabase
    .from('zone_locations')
    .select(LOCATION_FIELDS)
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
};

export const saveZone = async (zoneId: string | null, input: ZoneInput): Promise<ZoneRecord> => {
  const { data: savedZoneId, error: saveError } = await supabase.rpc('save_zone_configuration', {
    target_zone_id: zoneId,
    zone_name: input.name.trim(),
    requested_zone_type: input.zoneType,
    zone_color: input.color,
    zone_latitude: input.latitude,
    zone_longitude: input.longitude,
    zone_mapbox_place_id: input.placeId.trim() || null,
    zone_place_label: input.placeLabel.trim() || null,
    zone_locations: toLocationsPayload(input),
  });

  if (saveError) throw new Error(saveError.message);

  const { data, error } = await supabase
    .from('zones')
    .select(ZONE_FIELDS)
    .eq('id', savedZoneId)
    .single();

  if (error) throw new Error(error.message);
  return data;
};

export const deleteZone = async (zoneId: string): Promise<void> => {
  const { error } = await supabase
    .from('zones')
    .delete()
    .eq('id', zoneId);

  if (error) throw new Error(error.message);
};

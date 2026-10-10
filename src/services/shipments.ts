import { supabase } from '../config/supabase';
import type {
  PricingSimulationResult,
  ShipmentInput,
  ShipmentPricingOption,
  ShipmentPricingHistory,
  ShipmentPricingSummary,
  ShipmentRecord,
  ZoneRecord,
} from '../types';

const SHIPMENT_FIELDS = 'id, company_id, client_id, zone_id, tracking_number, shipment_date, status, delivery_address' as const;
const SHIPMENT_FIELDS_WITH_DESTINATION = `${SHIPMENT_FIELDS}, destination_city, destination_place_id, destination_latitude, destination_longitude, package_count, weight_kg, volume_m3, declared_value, distance_km, is_urgent, selected_rate_card_id, current_pricing_calculation_id` as const;
const ZONE_FIELDS = 'id, company_id, name, latitude, longitude, color, zone_type, mapbox_place_id, place_label' as const;

const saveShipment = async (
  shipmentId: string | null,
  input: ShipmentInput,
): Promise<ShipmentRecord> => {
  const { data, error } = await supabase.rpc('save_priced_shipment_with_destination', {
    target_shipment_id: shipmentId,
    shipment_tracking_number: input.trackingNumber.trim().toUpperCase(),
    shipment_client_id: input.clientId,
    shipment_delivery_address: input.deliveryAddress.trim(),
    shipment_status: input.status,
    requested_shipment_date: input.shipmentDate,
    city_name: input.destination.name,
    // RPC parameter name is retained for compatibility with deployed migrations.
    city_mapbox_place_id: input.destination.placeId,
    city_place_label: input.destination.label,
    city_latitude: input.destination.latitude,
    city_longitude: input.destination.longitude,
    target_rate_card_id: input.rateCardId || null,
    requested_package_count: input.packageCount,
    requested_weight_kg: input.weightKg,
    requested_volume_m3: input.volumeM3,
    requested_declared_value: input.declaredValue,
    requested_distance_km: input.distanceKm,
    requested_is_urgent: input.isUrgent,
  });

  if (error) throw new Error(error.message);
  return data;
};

export const listShipments = async (): Promise<ShipmentRecord[]> => {
  const { data, error } = await supabase
    .from('shipments')
    .select(SHIPMENT_FIELDS_WITH_DESTINATION)
    .order('tracking_number', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
};

export const listZonesForShipments = async (): Promise<ZoneRecord[]> => {
  const { data, error } = await supabase
    .from('zones')
    .select(ZONE_FIELDS)
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
};

export const listShipmentPricingOptions = async (
  shipmentDate: string,
): Promise<ShipmentPricingOption[]> => {
  const { data, error } = await supabase.rpc('get_shipment_pricing_options', {
    requested_shipment_date: shipmentDate,
  });
  if (error) throw new Error(error.message);
  return data;
};

export const previewShipmentPricing = async (
  input: ShipmentInput,
  zoneId: string | null,
): Promise<PricingSimulationResult> => {
  if (!input.rateCardId) throw new Error('Selecciona una lista tarifaria.');
  const { data, error } = await supabase.rpc('preview_shipment_pricing', {
    target_rate_card_id: input.rateCardId,
    requested_shipment_date: input.shipmentDate,
    shipment_client_id: input.clientId,
    shipment_zone_id: zoneId,
    shipment_destination_place_id: input.destination.placeId,
    requested_package_count: input.packageCount,
    requested_weight_kg: input.weightKg,
    requested_volume_m3: input.volumeM3,
    requested_declared_value: input.declaredValue,
    requested_distance_km: input.distanceKm,
    requested_is_urgent: input.isUrgent,
  });
  if (error) throw new Error(error.message);
  return data;
};

export const listCurrentShipmentPricingSummaries = async (): Promise<ShipmentPricingSummary[]> => {
  const { data, error } = await supabase.rpc('get_current_shipment_pricing_summaries', {});
  if (error) throw new Error(error.message);
  return data;
};

export const getShipmentPricingHistory = async (
  shipmentId: string,
): Promise<ShipmentPricingHistory> => {
  const { data, error } = await supabase.rpc('get_shipment_pricing_history', {
    target_shipment_id: shipmentId,
  });
  if (error) throw new Error(error.message);
  return data;
};

export const applyShipmentPricingAdjustment = async (
  shipmentId: string,
  conceptId: string,
  amount: number,
  reason: string,
): Promise<string> => {
  const { data, error } = await supabase.rpc('apply_shipment_pricing_adjustment', {
    target_shipment_id: shipmentId,
    target_concept_id: conceptId,
    requested_amount: amount,
    requested_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
  return data;
};

export const createShipment = async (input: ShipmentInput): Promise<ShipmentRecord> => {
  return saveShipment(null, input);
};

export const updateShipment = async (
  shipmentId: string,
  input: ShipmentInput,
): Promise<ShipmentRecord> => {
  return saveShipment(shipmentId, input);
};

export const deleteShipment = async (shipmentId: string): Promise<void> => {
  const { error } = await supabase.rpc('delete_authorized_shipment', {
    target_shipment_id: shipmentId,
  });

  if (error) throw new Error(error.message);
};

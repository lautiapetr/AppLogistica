import type { LucideIcon } from 'lucide-react';

export type RouteType = 'movements' | 'statistics' | 'clients' | 'zones' | 'team' | 'roles' | 'pricing' | 'settings';
export type UserRole = 'admin' | 'employee';
export type ProfileStatus = 'active' | 'pending' | 'rejected' | 'suspended';
export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePreference = 'company' | ThemeMode;
export type TableDensity = 'comfortable' | 'compact';
export type TableDensityPreference = 'company' | TableDensity;
export type SidebarPreference = 'company' | 'expanded' | 'collapsed';
export type AppLocale = 'es-AR' | 'en-US' | 'pt-BR';
export type AppCurrency = 'ARS' | 'USD' | 'EUR' | 'BRL';
export type AppDateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export type PermissionKey =
  | 'shipments.view'
  | 'shipments.create'
  | 'shipments.update'
  | 'shipments.delete'
  | 'clients.view'
  | 'clients.manage'
  | 'zones.view'
  | 'zones.manage'
  | 'statistics.view'
  | 'statistics.export'
  | 'members.view'
  | 'members.review'
  | 'members.manage_roles'
  | 'settings.view'
  | 'settings.manage'
  | 'pricing.view'
  | 'pricing.manage';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  roleId?: string;
  status: ProfileStatus;
  permissions: PermissionKey[];
  companyId?: string;
  companyName?: string;
  joinCode?: string;
  avatarUrl?: string;
  companySettings?: CompanySettings;
  preferences?: UserPreferences;
}

export interface NavItem {
  id: RouteType;
  label: string;
  icon: LucideIcon;
  permission: PermissionKey;
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type CompanyRow = {
  id: string;
  name: string;
  join_code: string;
};

type ProfileRow = {
  id: string;
  company_id: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  role_id: string | null;
  status: ProfileStatus;
};

type CompanySettingsRow = {
  company_id: string;
  display_name: string;
  logo_path: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  timezone: string;
  locale: AppLocale;
  currency: AppCurrency;
  date_format: AppDateFormat;
  mapbox_center_latitude: number;
  mapbox_center_longitude: number;
  mapbox_default_zoom: number;
  primary_color: string;
  accent_color: string;
  default_theme: ThemeMode;
  table_density: TableDensity;
  sidebar_default_collapsed: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type UserPreferencesRow = {
  profile_id: string;
  avatar_path: string | null;
  theme_preference: ThemePreference;
  table_density: TableDensityPreference;
  sidebar_preference: SidebarPreference;
  notifications_enabled: boolean;
  membership_notifications: boolean;
  default_landing_page: RouteType;
  created_at: string;
  updated_at: string;
};

export type TeamMemberRecord = ProfileRow;

export interface PermissionDefinition {
  key: PermissionKey;
  module: string;
  label: string;
  description: string;
}

export interface CompanyRoleRecord {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isDefault: boolean;
  isActive: boolean;
  memberCount: number;
  permissionKeys: PermissionKey[];
}

export type CompanyRoleOption = Pick<
  CompanyRoleRecord,
  'id' | 'name' | 'isDefault' | 'isActive'
>;

export interface RolesAndPermissions {
  permissions: PermissionDefinition[];
  roles: CompanyRoleRecord[];
}

export interface CompanyRoleInput {
  name: string;
  description: string;
  permissionKeys: PermissionKey[];
  isActive: boolean;
}

export interface CompanySettings {
  companyId: string;
  displayName: string;
  logoPath: string | null;
  logoUrl?: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  timezone: string;
  locale: AppLocale;
  currency: AppCurrency;
  dateFormat: AppDateFormat;
  mapCenterLatitude: number;
  mapCenterLongitude: number;
  mapDefaultZoom: number;
  primaryColor: string;
  accentColor: string;
  defaultTheme: ThemeMode;
  tableDensity: TableDensity;
  sidebarDefaultCollapsed: boolean;
}

export type LegacyCompanySettingsPayload = Omit<
  CompanySettings,
  'mapCenterLatitude' | 'mapCenterLongitude' | 'mapDefaultZoom'
> & {
  mapboxCenterLatitude: number;
  mapboxCenterLongitude: number;
  mapboxDefaultZoom: number;
};

export type CompanySettingsInput = Omit<CompanySettings, 'companyId' | 'logoUrl'>;

export interface UserPreferences {
  profileId: string;
  avatarPath: string | null;
  avatarUrl?: string | null;
  themePreference: ThemePreference;
  tableDensity: TableDensityPreference;
  sidebarPreference: SidebarPreference;
  notificationsEnabled: boolean;
  membershipNotifications: boolean;
  defaultLandingPage: RouteType;
}

export interface UserPreferencesInput extends Omit<
  UserPreferences,
  'profileId' | 'avatarUrl'
> {
  fullName: string;
}

export interface AppSettings {
  company: CompanySettings;
  user: UserPreferences;
}

type LegacyAppSettingsPayload = {
  company: LegacyCompanySettingsPayload;
  user: UserPreferences;
};

export type NotificationType =
  | 'membership_request'
  | 'membership_approved'
  | 'membership_rejected'
  | 'membership_suspended'
  | 'membership_reactivated';

export type NotificationRecord = {
  id: string;
  company_id: string;
  recipient_profile_id: string;
  type: NotificationType;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Json;
  read_at: string | null;
  created_at: string;
};

export type AuditEventRecord = {
  id: string;
  company_id: string;
  actor_profile_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  previous_data: Json | null;
  new_data: Json | null;
  created_at: string;
};

export type ClientStatus = 'active' | 'inactive';
export type ClientType = 'company' | 'individual';

export type ClientRecord = {
  id: string;
  company_id: string;
  client_type: ClientType;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  document_number: string | null;
  tax_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  status: ClientStatus;
};

export interface ClientInput {
  clientType: ClientType;
  businessName: string;
  firstName: string;
  lastName: string;
  documentNumber: string;
  taxId: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  status: ClientStatus;
}

export type ZoneColor = 'violet' | 'blue' | 'emerald' | 'amber' | 'rose';
export type ZoneType = 'group' | 'city';
export type ZoneLocationType = 'city' | 'custom';

export interface GeoPlace {
  placeId: string;
  name: string;
  label: string;
  latitude: number;
  longitude: number;
}

export type ZoneRecord = {
  id: string;
  company_id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  color: ZoneColor;
  zone_type: ZoneType;
  mapbox_place_id: string | null;
  place_label: string | null;
};

export type ZoneLocationRecord = {
  id: string;
  company_id: string;
  group_zone_id: string;
  location_type: ZoneLocationType;
  name: string;
  mapbox_place_id: string | null;
  place_label: string | null;
  latitude: number;
  longitude: number;
};

export interface ZoneLocationInput {
  locationType: ZoneLocationType;
  name: string;
  placeId: string;
  placeLabel: string;
  latitude: number;
  longitude: number;
}

export interface ZoneInput {
  name: string;
  zoneType: ZoneType;
  latitude: number | null;
  longitude: number | null;
  color: ZoneColor;
  placeId: string;
  placeLabel: string;
  locations: ZoneLocationInput[];
}

export type ShipmentStatus = 'pending' | 'in_transit' | 'delivered' | 'incident';

export type ShipmentRecord = {
  id: string;
  company_id: string;
  client_id: string | null;
  zone_id: string | null;
  tracking_number: string;
  shipment_date: string;
  status: ShipmentStatus;
  delivery_address: string;
  destination_city: string | null;
  destination_place_id: string | null;
  destination_latitude: number | null;
  destination_longitude: number | null;
  package_count: number;
  weight_kg: number;
  volume_m3: number;
  declared_value: number;
  distance_km: number;
  is_urgent: boolean;
  selected_rate_card_id: string | null;
  current_pricing_calculation_id: string | null;
};

export interface ShipmentInput {
  trackingNumber: string;
  shipmentDate: string;
  clientId: string;
  deliveryAddress: string;
  status: ShipmentStatus;
  destination: GeoPlace;
  rateCardId: string;
  packageCount: number;
  weightKg: number;
  volumeM3: number;
  declaredValue: number;
  distanceKm: number;
  isUrgent: boolean;
}

export interface ShipmentPricingOption {
  rateCardId: string;
  rateCardName: string;
  versionId: string;
  versionNumber: number;
  currency: AppCurrency;
}

export interface ShipmentPricingSummary {
  shipmentId: string;
  calculationId: string;
  rateCardName: string;
  versionNumber: number;
  currency: AppCurrency;
  customerTotal: number;
  internalCostTotal: number;
  commissionTotal: number;
  taxTotal: number;
  calculatedAt: string;
}

export interface ShipmentPricingHistoryConcept {
  id: string;
  name: string;
  category: EconomicConceptCategory;
}

export interface ShipmentPricingHistoryLineItem {
  lineNumber: number;
  conceptName: string;
  ruleName: string;
  category: EconomicConceptCategory;
  calculationType: PricingCalculationType | 'manual';
  amount: number;
  netAmount: number;
  taxAmount: number;
  taxBehavior: PricingTaxBehavior;
  taxRate: number | null;
  taxLabel: string | null;
  isManual: boolean;
  adjustmentReason: string | null;
  createdByName: string | null;
}

export interface ShipmentPricingHistoryCalculation {
  id: string;
  sequence: number;
  reason: 'creation' | 'movement_update' | 'manual_recalculation' | 'manual_adjustment';
  rateCardName: string;
  versionNumber: number;
  currency: AppCurrency;
  inputs: Json;
  chargeTotal: number;
  discountTotal: number;
  customerTotal: number;
  internalCostTotal: number;
  commissionTotal: number;
  taxTotal: number;
  includedTaxTotal: number;
  addedTaxTotal: number;
  calculatedAt: string;
  calculatedByName: string | null;
  isCurrent: boolean;
  lineItems: ShipmentPricingHistoryLineItem[];
}

export interface ShipmentPricingHistory {
  shipment: {
    id: string;
    trackingNumber: string;
    currentCalculationId: string | null;
  };
  concepts: ShipmentPricingHistoryConcept[];
  calculations: ShipmentPricingHistoryCalculation[];
}

export interface StatisticsFilters {
  dateFrom: string;
  dateTo: string;
  status: ShipmentStatus | 'all';
  zoneId: string;
  clientId: string;
  destinationPlaceId: string;
}

export type StatisticsExportRow = Pick<
  ShipmentRecord,
  | 'tracking_number'
  | 'shipment_date'
  | 'status'
  | 'delivery_address'
  | 'destination_city'
  | 'destination_place_id'
  | 'client_id'
  | 'zone_id'
>;

export interface FinancialStatisticsExportRow {
  shipment_id: string;
  tracking_number: string;
  shipment_date: string;
  status: ShipmentStatus;
  client_name: string;
  zone_name: string | null;
  destination_city: string | null;
  rate_card_name: string;
  version_number: number;
  currency: AppCurrency;
  charge_total: number;
  discount_total: number;
  estimated_revenue: number;
  internal_cost_total: number;
  commission_total: number;
  estimated_cost_total: number;
  estimated_margin: number;
  margin_rate: number;
  tax_total: number;
  included_tax_total: number;
  added_tax_total: number;
  calculated_at: string;
}

export interface StatisticsSummary {
  total: number;
  pending: number;
  inTransit: number;
  delivered: number;
  incidents: number;
  deliveryRate: number;
  averageDailyVolume: number;
  previousTotal: number;
  previousDelivered: number;
  previousIncidents: number;
  previousDeliveryRate: number;
}

export interface StatisticsTrendPoint {
  date: string;
  total: number;
  delivered: number;
  incidents: number;
}

export interface StatisticsStatusPoint {
  status: ShipmentStatus;
  count: number;
}

export interface StatisticsRankingItem {
  id: string;
  label: string;
  count: number;
}

export interface OperationalStatistics {
  dateFrom: string;
  dateTo: string;
  previousDateFrom: string;
  previousDateTo: string;
  summary: StatisticsSummary;
  trend: StatisticsTrendPoint[];
  statusDistribution: StatisticsStatusPoint[];
  topZones: StatisticsRankingItem[];
  topCities: StatisticsRankingItem[];
  topClients: StatisticsRankingItem[];
}

export interface FinancialStatisticsCoverage {
  totalShipments: number;
  pricedShipments: number;
  unpricedShipments: number;
  coverageRate: number;
}

export interface FinancialCurrencySummary {
  currency: AppCurrency;
  pricedShipments: number;
  chargeTotal: number;
  discountTotal: number;
  estimatedRevenue: number;
  internalCostTotal: number;
  commissionTotal: number;
  estimatedCostTotal: number;
  estimatedMargin: number;
  marginRate: number;
  averageTicket: number;
  taxTotal: number;
  includedTaxTotal: number;
  addedTaxTotal: number;
  previousPricedShipments: number;
  previousEstimatedRevenue: number;
  previousEstimatedMargin: number;
}

export interface FinancialStatisticsRankingItem {
  id: string;
  label: string;
  currency: AppCurrency;
  shipmentCount: number;
  revenue: number;
  cost: number;
  margin: number;
  marginRate: number;
}

export interface FinancialStatistics {
  dateFrom: string;
  dateTo: string;
  previousDateFrom: string;
  previousDateTo: string;
  coverage: FinancialStatisticsCoverage;
  currencies: FinancialCurrencySummary[];
  topClients: FinancialStatisticsRankingItem[];
  topZones: FinancialStatisticsRankingItem[];
  topCities: FinancialStatisticsRankingItem[];
}

export interface RateCardVersionProfitability {
  rateCardId: string;
  rateCardVersionId: string;
  rateCardName: string;
  versionNumber: number;
  currency: AppCurrency;
  shipmentCount: number;
  revenue: number;
  cost: number;
  margin: number;
  marginRate: number;
  averageTicket: number;
}

export type MarginAlertSeverity = 'negative' | 'low';

export interface ShipmentMarginAlert {
  shipmentId: string;
  trackingNumber: string;
  shipmentDate: string;
  clientId: string | null;
  clientName: string;
  rateCardName: string;
  versionNumber: number;
  currency: AppCurrency;
  revenue: number;
  cost: number;
  margin: number;
  marginRate: number;
  severity: MarginAlertSeverity;
}

export interface PricingProfitabilityInsights {
  lowMarginThreshold: number;
  alertCount: number;
  rateCardVersions: RateCardVersionProfitability[];
  marginAlerts: ShipmentMarginAlert[];
}

export interface StatisticsFilterOption {
  id: string;
  label: string;
}

export interface StatisticsZoneOption extends StatisticsFilterOption {
  type: ZoneType;
}

export interface StatisticsFilterOptions {
  clients: StatisticsFilterOption[];
  zones: StatisticsZoneOption[];
  cities: StatisticsFilterOption[];
}

export type EconomicConceptCategory = 'charge' | 'discount' | 'cost' | 'commission';
export type RateCardVersionStatus = 'draft' | 'published' | 'retired';
export type PricingCalculationType = 'fixed' | 'percentage' | 'formula';
export type PricingTaxBehavior = 'none' | 'included' | 'added';
export type PricingScopeType = 'client' | 'zone' | 'destination';

export interface EconomicConcept {
  id: string;
  code: string;
  name: string;
  category: EconomicConceptCategory;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
}

export interface PricingScope {
  type: PricingScopeType;
  key: string;
}

export interface PricingRule {
  id: string;
  conceptId: string;
  name: string;
  description: string | null;
  priority: number;
  calculationType: PricingCalculationType;
  fixedAmount: number | null;
  percentage: number | null;
  formula: Json | null;
  minimumAmount: number | null;
  maximumAmount: number | null;
  taxBehavior: PricingTaxBehavior;
  taxRate: number | null;
  taxLabel: string | null;
  conditions: Json;
  isCumulative: boolean;
  isActive: boolean;
  scopes: PricingScope[];
}

export interface RateCardVersion {
  id: string;
  versionNumber: number;
  status: RateCardVersionStatus;
  currency: AppCurrency;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  notes: string | null;
  publishedAt: string | null;
  rules: PricingRule[];
}

export interface RateCard {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  versions: RateCardVersion[];
}

export interface PricingOption {
  id: string;
  label: string;
}

export interface PricingWorkspace {
  currency: AppCurrency;
  concepts: EconomicConcept[];
  rateCards: RateCard[];
  clients: PricingOption[];
  zones: PricingOption[];
  destinations: PricingOption[];
}

export interface CompanyHoliday {
  id: string;
  date: string;
  name: string;
  isActive: boolean;
}

export interface CompanyHolidayInput {
  date: string;
  name: string;
  isActive: boolean;
}

export interface EconomicConceptInput {
  name: string;
  code: string;
  category: EconomicConceptCategory;
  description: string;
  isActive: boolean;
}

export interface RateCardInput {
  name: string;
  description: string;
  isActive: boolean;
}

export interface PricingRuleInput {
  conceptId: string;
  name: string;
  description: string;
  priority: number;
  calculationType: PricingCalculationType;
  fixedAmount: number | null;
  percentage: number | null;
  formula: Json | null;
  minimumAmount: number | null;
  maximumAmount: number | null;
  taxBehavior: PricingTaxBehavior;
  taxRate: number | null;
  taxLabel: string | null;
  conditions: Json;
  isCumulative: boolean;
  isActive: boolean;
  scopes: PricingScope[];
}

export interface PricingSimulationInput {
  clientId: string;
  zoneId: string;
  destinationPlaceId: string;
  packageCount: number;
  weightKg: number;
  volumeM3: number;
  declaredValue: number;
  distanceKm: number;
  urgency: boolean;
  weekend: boolean;
}

export interface PricingSimulationLineItem {
  ruleId: string;
  conceptId: string;
  conceptName: string;
  ruleName: string;
  category: EconomicConceptCategory;
  calculationType: PricingCalculationType;
  amount: number;
  netAmount: number;
  taxAmount: number;
  taxBehavior: PricingTaxBehavior;
  taxRate: number | null;
  taxLabel: string | null;
}

export interface PricingSimulationResult {
  rateCardVersionId: string;
  versionNumber: number;
  currency: AppCurrency;
  inputs: Json;
  lineItems: PricingSimulationLineItem[];
  chargeTotal: number;
  discountTotal: number;
  customerTotal: number;
  internalCostTotal: number;
  commissionTotal: number;
  taxTotal: number;
  includedTaxTotal: number;
  addedTaxTotal: number;
}

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: CompanyRow;
        Insert: Omit<CompanyRow, 'id'> & { id?: string };
        Update: Partial<CompanyRow>;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: ProfileRow;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      clients: {
        Row: ClientRecord;
        Insert: Omit<ClientRecord, 'id' | 'company_id'> & {
          id?: string;
          company_id?: string;
        };
        Update: Partial<ClientRecord>;
        Relationships: [];
      };
      zones: {
        Row: ZoneRecord;
        Insert: Omit<ZoneRecord, 'id' | 'company_id'> & {
          id?: string;
          company_id?: string;
        };
        Update: Partial<ZoneRecord>;
        Relationships: [];
      };
      zone_locations: {
        Row: ZoneLocationRecord;
        Insert: Omit<ZoneLocationRecord, 'id' | 'company_id'> & {
          id?: string;
          company_id?: string;
        };
        Update: Partial<ZoneLocationRecord>;
        Relationships: [];
      };
      shipments: {
        Row: ShipmentRecord;
        Insert: Omit<ShipmentRecord, 'id' | 'company_id'> & {
          id?: string;
          company_id?: string;
        };
        Update: Partial<ShipmentRecord>;
        Relationships: [];
      };
      notifications: {
        Row: NotificationRecord;
        Insert: Omit<NotificationRecord, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Pick<NotificationRecord, 'read_at'>;
        Relationships: [];
      };
      audit_events: {
        Row: AuditEventRecord;
        Insert: Omit<AuditEventRecord, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      permissions: {
        Row: {
          key: PermissionKey;
          module: string;
          label: string;
          description: string;
          sort_order: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      company_roles: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          description: string | null;
          is_system: boolean;
          is_default: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      company_role_permissions: {
        Row: { role_id: string; permission_key: PermissionKey };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      company_settings: {
        Row: CompanySettingsRow;
        Insert: Partial<CompanySettingsRow> & Pick<CompanySettingsRow, 'company_id' | 'display_name'>;
        Update: Partial<CompanySettingsRow>;
        Relationships: [];
      };
      user_preferences: {
        Row: UserPreferencesRow;
        Insert: Partial<UserPreferencesRow> & Pick<UserPreferencesRow, 'profile_id'>;
        Update: Partial<UserPreferencesRow>;
        Relationships: [];
      };
      economic_concepts: {
        Row: {
          id: string;
          company_id: string;
          code: string;
          name: string;
          category: EconomicConceptCategory;
          description: string | null;
          is_system: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      rate_cards: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      rate_card_versions: {
        Row: {
          id: string;
          company_id: string;
          rate_card_id: string;
          version_number: number;
          status: RateCardVersionStatus;
          currency: AppCurrency;
          effective_from: string | null;
          effective_to: string | null;
          notes: string | null;
          created_by: string | null;
          published_by: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      pricing_rules: {
        Row: never;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      pricing_rule_scopes: {
        Row: never;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      shipment_pricing_calculations: {
        Row: never;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      shipment_charges: {
        Row: never;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      register_company: {
        Args: {
          company_name: string;
          full_name: string;
        };
        Returns: {
          company_id: string;
          join_code: string;
        };
      };
      register_employee: {
        Args: {
          invitation_code: string;
          full_name: string;
        };
        Returns: {
          status: 'pending';
        };
      };
      review_membership_request: {
        Args: {
          target_profile_id: string;
          decision: 'approve' | 'reject';
        };
        Returns: TeamMemberRecord;
      };
      manage_employee_access: {
        Args: {
          target_profile_id: string;
          requested_status: 'active' | 'suspended';
        };
        Returns: TeamMemberRecord;
      };
      mark_notification_read: {
        Args: { target_notification_id: string };
        Returns: undefined;
      };
      mark_all_notifications_read: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      get_statistics_filter_options: {
        Args: Record<string, never>;
        Returns: StatisticsFilterOptions;
      };
      get_operational_statistics: {
        Args: {
          requested_date_from: string;
          requested_date_to: string;
          requested_status: ShipmentStatus | null;
          requested_zone_id: string | null;
          requested_client_id: string | null;
          requested_destination_place_id: string | null;
        };
        Returns: OperationalStatistics;
      };
      get_my_permissions: {
        Args: Record<string, never>;
        Returns: PermissionKey[];
      };
      get_app_settings: {
        Args: Record<string, never>;
        Returns: LegacyAppSettingsPayload;
      };
      save_company_settings: {
        Args: { requested_settings: Json };
        Returns: LegacyCompanySettingsPayload;
      };
      save_user_preferences: {
        Args: { requested_preferences: Json };
        Returns: UserPreferences & { fullName: string };
      };
      get_pricing_workspace: {
        Args: Record<string, never>;
        Returns: PricingWorkspace;
      };
      get_company_holidays: {
        Args: { requested_year: number };
        Returns: CompanyHoliday[];
      };
      save_company_holiday: {
        Args: {
          target_holiday_id: string | null;
          requested_date: string;
          requested_name: string;
          requested_is_active: boolean;
        };
        Returns: string;
      };
      save_economic_concept: {
        Args: {
          target_concept_id: string | null;
          requested_name: string;
          requested_code: string;
          requested_category: EconomicConceptCategory;
          requested_description: string;
          requested_is_active: boolean;
        };
        Returns: string;
      };
      save_rate_card: {
        Args: {
          target_rate_card_id: string | null;
          requested_name: string;
          requested_description: string;
          requested_is_active: boolean;
        };
        Returns: string;
      };
      create_rate_card_draft: {
        Args: { target_rate_card_id: string };
        Returns: string;
      };
      save_pricing_rule: {
        Args: {
          target_rule_id: string | null;
          target_version_id: string;
          target_concept_id: string;
          requested_name: string;
          requested_description: string;
          requested_priority: number;
          requested_calculation_type: PricingCalculationType;
          requested_fixed_amount: number | null;
          requested_percentage: number | null;
          requested_formula: Json | null;
          requested_minimum_amount: number | null;
          requested_maximum_amount: number | null;
          requested_tax_behavior: PricingTaxBehavior;
          requested_tax_rate: number | null;
          requested_tax_label: string;
          requested_conditions: Json;
          requested_is_cumulative: boolean;
          requested_is_active: boolean;
          requested_scopes: Json;
        };
        Returns: string;
      };
      publish_rate_card_version: {
        Args: {
          target_version_id: string;
          requested_effective_from: string;
          requested_effective_to: string | null;
          requested_currency: AppCurrency;
          requested_notes: string;
        };
        Returns: string;
      };
      simulate_pricing: {
        Args: { target_version_id: string; requested_inputs: Json };
        Returns: PricingSimulationResult;
      };
      get_roles_and_permissions: {
        Args: Record<string, never>;
        Returns: RolesAndPermissions;
      };
      save_company_role: {
        Args: {
          target_role_id: string | null;
          role_name: string;
          role_description: string;
          requested_permission_keys: PermissionKey[];
          requested_is_active: boolean;
        };
        Returns: CompanyRoleRecord;
      };
      assign_employee_role: {
        Args: { target_profile_id: string; target_role_id: string };
        Returns: TeamMemberRecord;
      };
      get_authorized_statistics_filter_options: {
        Args: Record<string, never>;
        Returns: StatisticsFilterOptions;
      };
      get_authorized_operational_statistics: {
        Args: {
          requested_date_from: string;
          requested_date_to: string;
          requested_status: ShipmentStatus | null;
          requested_zone_id: string | null;
          requested_client_id: string | null;
          requested_destination_place_id: string | null;
        };
        Returns: OperationalStatistics;
      };
      get_authorized_financial_statistics: {
        Args: {
          requested_date_from: string;
          requested_date_to: string;
          requested_status: ShipmentStatus | null;
          requested_zone_id: string | null;
          requested_client_id: string | null;
          requested_destination_place_id: string | null;
        };
        Returns: FinancialStatistics;
      };
      get_authorized_pricing_profitability_insights: {
        Args: {
          requested_date_from: string;
          requested_date_to: string;
          requested_status: ShipmentStatus | null;
          requested_zone_id: string | null;
          requested_client_id: string | null;
          requested_destination_place_id: string | null;
        };
        Returns: PricingProfitabilityInsights;
      };
      get_operational_statistics_export: {
        Args: {
          requested_date_from: string;
          requested_date_to: string;
          requested_status: ShipmentStatus | null;
          requested_zone_id: string | null;
          requested_client_id: string | null;
          requested_destination_place_id: string | null;
          requested_offset: number;
          requested_limit: number;
        };
        Returns: StatisticsExportRow[];
      };
      get_financial_statistics_export: {
        Args: {
          requested_date_from: string;
          requested_date_to: string;
          requested_status: ShipmentStatus | null;
          requested_zone_id: string | null;
          requested_client_id: string | null;
          requested_destination_place_id: string | null;
          requested_offset: number;
          requested_limit: number;
        };
        Returns: FinancialStatisticsExportRow[];
      };
      save_zone_configuration: {
        Args: {
          target_zone_id: string | null;
          zone_name: string;
          requested_zone_type: ZoneType;
          zone_color: ZoneColor;
          zone_latitude: number | null;
          zone_longitude: number | null;
          zone_mapbox_place_id: string | null;
          zone_place_label: string | null;
          zone_locations: Json;
        };
        Returns: string;
      };
      resolve_destination_zone: {
        Args: {
          city_name: string;
          city_mapbox_place_id: string;
          city_place_label: string;
          city_latitude: number;
          city_longitude: number;
        };
        Returns: string;
      };
      save_shipment_with_destination: {
        Args: {
          target_shipment_id: string | null;
          shipment_tracking_number: string;
          shipment_client_id: string;
          shipment_delivery_address: string;
          shipment_status: ShipmentStatus;
          requested_shipment_date: string;
          city_name: string;
          city_mapbox_place_id: string;
          city_place_label: string;
          city_latitude: number;
          city_longitude: number;
        };
        Returns: ShipmentRecord;
      };
      save_authorized_shipment_with_destination: {
        Args: {
          target_shipment_id: string | null;
          shipment_tracking_number: string;
          shipment_client_id: string;
          shipment_delivery_address: string;
          shipment_status: ShipmentStatus;
          requested_shipment_date: string;
          city_name: string;
          city_mapbox_place_id: string;
          city_place_label: string;
          city_latitude: number;
          city_longitude: number;
        };
        Returns: ShipmentRecord;
      };
      get_shipment_pricing_options: {
        Args: { requested_shipment_date: string };
        Returns: ShipmentPricingOption[];
      };
      preview_shipment_pricing: {
        Args: {
          target_rate_card_id: string;
          requested_shipment_date: string;
          shipment_client_id: string;
          shipment_zone_id: string | null;
          shipment_destination_place_id: string;
          requested_package_count: number;
          requested_weight_kg: number;
          requested_volume_m3: number;
          requested_declared_value: number;
          requested_distance_km: number;
          requested_is_urgent: boolean;
        };
        Returns: PricingSimulationResult;
      };
      save_priced_shipment_with_destination: {
        Args: {
          target_shipment_id: string | null;
          shipment_tracking_number: string;
          shipment_client_id: string;
          shipment_delivery_address: string;
          shipment_status: ShipmentStatus;
          requested_shipment_date: string;
          city_name: string;
          city_mapbox_place_id: string;
          city_place_label: string;
          city_latitude: number;
          city_longitude: number;
          target_rate_card_id: string | null;
          requested_package_count: number;
          requested_weight_kg: number;
          requested_volume_m3: number;
          requested_declared_value: number;
          requested_distance_km: number;
          requested_is_urgent: boolean;
        };
        Returns: ShipmentRecord;
      };
      get_current_shipment_pricing_summaries: {
        Args: Record<string, never>;
        Returns: ShipmentPricingSummary[];
      };
      delete_authorized_shipment: {
        Args: { target_shipment_id: string };
        Returns: undefined;
      };
      get_shipment_pricing_history: {
        Args: { target_shipment_id: string };
        Returns: ShipmentPricingHistory;
      };
      apply_shipment_pricing_adjustment: {
        Args: {
          target_shipment_id: string;
          target_concept_id: string;
          requested_amount: number;
          requested_reason: string;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

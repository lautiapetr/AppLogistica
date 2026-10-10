import { supabase } from '../config/supabase';
import type {
  FinancialStatistics,
  FinancialStatisticsExportRow,
  OperationalStatistics,
  PricingProfitabilityInsights,
  StatisticsExportRow,
  StatisticsFilterOptions,
  StatisticsFilters,
} from '../types';

const toStatisticsRpcArgs = (filters: StatisticsFilters) => ({
  requested_date_from: filters.dateFrom,
  requested_date_to: filters.dateTo,
  requested_status: filters.status === 'all' ? null : filters.status,
  requested_zone_id: filters.zoneId || null,
  requested_client_id: filters.clientId || null,
  requested_destination_place_id: filters.destinationPlaceId || null,
});

const EXPORT_PAGE_SIZE = 1000;

export const getStatisticsFilterOptions = async (): Promise<StatisticsFilterOptions> => {
  const { data, error } = await supabase.rpc('get_authorized_statistics_filter_options', {});
  if (error) throw new Error(error.message);
  return data;
};

export const getOperationalStatistics = async (
  filters: StatisticsFilters,
): Promise<OperationalStatistics> => {
  const { data, error } = await supabase.rpc(
    'get_authorized_operational_statistics',
    toStatisticsRpcArgs(filters),
  );

  if (error) throw new Error(error.message);
  return data;
};

export const getFinancialStatistics = async (
  filters: StatisticsFilters,
): Promise<FinancialStatistics> => {
  const { data, error } = await supabase.rpc(
    'get_authorized_financial_statistics',
    toStatisticsRpcArgs(filters),
  );

  if (error) throw new Error(error.message);
  return data;
};

export const getPricingProfitabilityInsights = async (
  filters: StatisticsFilters,
): Promise<PricingProfitabilityInsights> => {
  const { data, error } = await supabase.rpc(
    'get_authorized_pricing_profitability_insights',
    toStatisticsRpcArgs(filters),
  );

  if (error) throw new Error(error.message);
  return data;
};

export const getOperationalStatisticsExport = async (
  filters: StatisticsFilters,
): Promise<StatisticsExportRow[]> => {
  const rows: StatisticsExportRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.rpc('get_operational_statistics_export', {
      requested_date_from: filters.dateFrom,
      requested_date_to: filters.dateTo,
      requested_status: filters.status === 'all' ? null : filters.status,
      requested_zone_id: filters.zoneId || null,
      requested_client_id: filters.clientId || null,
      requested_destination_place_id: filters.destinationPlaceId || null,
      requested_offset: offset,
      requested_limit: EXPORT_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);

    rows.push(...data);
    if (data.length < EXPORT_PAGE_SIZE) break;
    offset += EXPORT_PAGE_SIZE;
  }

  return rows;
};

export const getFinancialStatisticsExport = async (
  filters: StatisticsFilters,
): Promise<FinancialStatisticsExportRow[]> => {
  const rows: FinancialStatisticsExportRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.rpc('get_financial_statistics_export', {
      ...toStatisticsRpcArgs(filters),
      requested_offset: offset,
      requested_limit: EXPORT_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);

    rows.push(...data);
    if (data.length < EXPORT_PAGE_SIZE) break;
    offset += EXPORT_PAGE_SIZE;
  }

  return rows;
};

import { supabase } from '../config/supabase';
import type {
  AppCurrency,
  CompanyHoliday,
  CompanyHolidayInput,
  EconomicConceptInput,
  Json,
  PricingRuleInput,
  PricingSimulationInput,
  PricingSimulationResult,
  PricingWorkspace,
  RateCardInput,
} from '../types';

export const getPricingWorkspace = async (): Promise<PricingWorkspace> => {
  const { data, error } = await supabase.rpc('get_pricing_workspace', {});
  if (error) throw new Error(error.message);
  return data;
};

export const getCompanyHolidays = async (year: number): Promise<CompanyHoliday[]> => {
  const { data, error } = await supabase.rpc('get_company_holidays', {
    requested_year: year,
  });
  if (error) throw new Error(error.message);
  return data;
};

export const saveCompanyHoliday = async (
  holidayId: string | null,
  input: CompanyHolidayInput,
): Promise<string> => {
  const { data, error } = await supabase.rpc('save_company_holiday', {
    target_holiday_id: holidayId,
    requested_date: input.date,
    requested_name: input.name.trim(),
    requested_is_active: input.isActive,
  });
  if (error) throw new Error(error.message);
  return data;
};

export const saveEconomicConcept = async (
  conceptId: string | null,
  input: EconomicConceptInput,
): Promise<string> => {
  const { data, error } = await supabase.rpc('save_economic_concept', {
    target_concept_id: conceptId,
    requested_name: input.name.trim(),
    requested_code: input.code.trim(),
    requested_category: input.category,
    requested_description: input.description.trim(),
    requested_is_active: input.isActive,
  });
  if (error) throw new Error(error.message);
  return data;
};

export const saveRateCard = async (
  rateCardId: string | null,
  input: RateCardInput,
): Promise<string> => {
  const { data, error } = await supabase.rpc('save_rate_card', {
    target_rate_card_id: rateCardId,
    requested_name: input.name.trim(),
    requested_description: input.description.trim(),
    requested_is_active: input.isActive,
  });
  if (error) throw new Error(error.message);
  return data;
};

export const createRateCardDraft = async (rateCardId: string): Promise<string> => {
  const { data, error } = await supabase.rpc('create_rate_card_draft', {
    target_rate_card_id: rateCardId,
  });
  if (error) throw new Error(error.message);
  return data;
};

export const savePricingRule = async (
  ruleId: string | null,
  versionId: string,
  input: PricingRuleInput,
): Promise<string> => {
  const { data, error } = await supabase.rpc('save_pricing_rule', {
    target_rule_id: ruleId,
    target_version_id: versionId,
    target_concept_id: input.conceptId,
    requested_name: input.name.trim(),
    requested_description: input.description.trim(),
    requested_priority: input.priority,
    requested_calculation_type: input.calculationType,
    requested_fixed_amount: input.fixedAmount,
    requested_percentage: input.percentage,
    requested_formula: input.formula,
    requested_minimum_amount: input.minimumAmount,
    requested_maximum_amount: input.maximumAmount,
    requested_tax_behavior: input.taxBehavior,
    requested_tax_rate: input.taxRate,
    requested_tax_label: input.taxLabel ?? '',
    requested_conditions: input.conditions,
    requested_is_cumulative: input.isCumulative,
    requested_is_active: input.isActive,
    requested_scopes: input.scopes as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data;
};

export const publishRateCardVersion = async (
  versionId: string,
  effectiveFrom: string,
  effectiveTo: string,
  currency: AppCurrency,
  notes: string,
): Promise<string> => {
  const { data, error } = await supabase.rpc('publish_rate_card_version', {
    target_version_id: versionId,
    requested_effective_from: effectiveFrom,
    requested_effective_to: effectiveTo || null,
    requested_currency: currency,
    requested_notes: notes.trim(),
  });
  if (error) throw new Error(error.message);
  return data;
};

export const simulatePricing = async (
  versionId: string,
  input: PricingSimulationInput,
): Promise<PricingSimulationResult> => {
  const { data, error } = await supabase.rpc('simulate_pricing', {
    target_version_id: versionId,
    requested_inputs: input as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data;
};

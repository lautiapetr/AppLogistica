import { supabase } from '../config/supabase';
import type { ClientInput, ClientRecord } from '../types';

const CLIENT_FIELDS = 'id, company_id, client_type, business_name, first_name, last_name, document_number, tax_id, contact_email, contact_phone, address, status' as const;

const optionalText = (value: string): string | null => value.trim() || null;
const optionalDigits = (value: string): string | null => value.replace(/\D/g, '') || null;

export const getClientDisplayName = (client: ClientRecord): string => (
  client.client_type === 'company'
    ? client.business_name ?? 'Empresa sin nombre'
    : [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Individuo sin nombre'
);

const toClientPayload = (input: ClientInput) => ({
  client_type: input.clientType,
  business_name: input.clientType === 'company' ? input.businessName.trim() : null,
  first_name: input.clientType === 'individual' ? input.firstName.trim() : null,
  last_name: input.clientType === 'individual' ? input.lastName.trim() : null,
  document_number: input.clientType === 'individual'
    ? optionalDigits(input.documentNumber)
    : null,
  tax_id: optionalDigits(input.taxId),
  contact_email: optionalText(input.contactEmail)?.toLowerCase() ?? null,
  contact_phone: optionalText(input.contactPhone),
  address: optionalText(input.address),
  status: input.status,
});

export const listClients = async (): Promise<ClientRecord[]> => {
  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_FIELDS);

  if (error) throw new Error(error.message);
  return data;
};

export const createClient = async (input: ClientInput): Promise<ClientRecord> => {
  const { data, error } = await supabase
    .from('clients')
    .insert(toClientPayload(input))
    .select(CLIENT_FIELDS)
    .single();

  if (error) throw new Error(error.message);
  return data;
};

export const updateClient = async (
  clientId: string,
  input: ClientInput,
): Promise<ClientRecord> => {
  const { data, error } = await supabase
    .from('clients')
    .update(toClientPayload(input))
    .eq('id', clientId)
    .select(CLIENT_FIELDS)
    .single();

  if (error) throw new Error(error.message);
  return data;
};

export const deleteClient = async (clientId: string): Promise<void> => {
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', clientId);

  if (error?.code === '23503') {
    throw new Error(
      'No puedes eliminar este cliente porque tiene movimientos asociados. Márcalo como inactivo para conservar su historial.',
    );
  }

  if (error) throw new Error(error.message);
};

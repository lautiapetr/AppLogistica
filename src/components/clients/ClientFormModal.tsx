import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Building2,
  Fingerprint,
  Mail,
  MapPin,
  Phone,
  UserRound,
  X,
} from 'lucide-react';
import type {
  ClientInput,
  ClientRecord,
  ClientStatus,
  ClientType,
} from '../../types';

interface ClientFormModalProps {
  client: ClientRecord | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: ClientInput) => Promise<void>;
}

interface OptionalFieldProps {
  id: string;
  label: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  children: ReactNode;
}

const OptionalField = ({
  id,
  label,
  enabled,
  onEnabledChange,
  children,
}: OptionalFieldProps) => (
  <div className={`rounded-xl border p-3 transition-colors ${
    enabled ? 'border-[var(--color-primary)]/25 bg-[var(--color-primary)]/5' : 'border-slate-200 bg-slate-50/60'
  }`}>
    <label htmlFor={`${id}-enabled`} className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
      <input
        id={`${id}-enabled`}
        type="checkbox"
        checked={enabled}
        onChange={(event) => onEnabledChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 accent-[var(--color-primary)]"
      />
      {label}
      <span className="ml-auto text-xs font-normal text-slate-400">
        {enabled ? 'Incluido' : 'Sin informar'}
      </span>
    </label>
    {enabled && <div className="mt-3">{children}</div>}
  </div>
);

const digitsOnly = (value: string, maximumLength: number) => value
  .replace(/\D/g, '')
  .slice(0, maximumLength);

export const ClientFormModal = ({
  client,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ClientFormModalProps) => {
  const [clientType, setClientType] = useState<ClientType>(client?.client_type ?? 'company');
  const [businessName, setBusinessName] = useState(client?.business_name ?? '');
  const [firstName, setFirstName] = useState(client?.first_name ?? '');
  const [lastName, setLastName] = useState(client?.last_name ?? '');
  const [documentNumber, setDocumentNumber] = useState(client?.document_number ?? '');
  const [taxId, setTaxId] = useState(client?.tax_id ?? '');
  const [contactEmail, setContactEmail] = useState(client?.contact_email ?? '');
  const [contactPhone, setContactPhone] = useState(client?.contact_phone ?? '');
  const [address, setAddress] = useState(client?.address ?? '');
  const [status, setStatus] = useState<ClientStatus>(client?.status ?? 'active');

  const [hasDocumentNumber, setHasDocumentNumber] = useState(client?.document_number !== null && client?.document_number !== undefined);
  const [hasTaxId, setHasTaxId] = useState(client?.tax_id !== null && client?.tax_id !== undefined);
  const [hasEmail, setHasEmail] = useState(client?.contact_email !== null && client?.contact_email !== undefined);
  const [hasPhone, setHasPhone] = useState(client?.contact_phone !== null && client?.contact_phone !== undefined);
  const [hasAddress, setHasAddress] = useState(client?.address !== null && client?.address !== undefined);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit({
      clientType,
      businessName,
      firstName,
      lastName,
      documentNumber: clientType === 'individual' && hasDocumentNumber ? documentNumber : '',
      taxId: hasTaxId ? taxId : '',
      contactEmail: hasEmail ? contactEmail : '',
      contactPhone: hasPhone ? contactPhone : '',
      address: hasAddress ? address : '',
      status,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar formulario"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-form-title"
        className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="client-form-title" className="text-xl font-bold text-slate-900">
              {client ? 'Editar cliente' : 'Agregar cliente'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Elige el tipo de cliente y activa únicamente los datos disponibles.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Tipo de cliente</legend>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setClientType('company')}
                className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                  clientType === 'company'
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Building2 size={21} />
                <span className="font-semibold">Empresa</span>
              </button>
              <button
                type="button"
                onClick={() => setClientType('individual')}
                className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                  clientType === 'individual'
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <UserRound size={21} />
                <span className="font-semibold">Individuo</span>
              </button>
            </div>
          </fieldset>

          {clientType === 'company' ? (
            <div>
              <label htmlFor="client-business-name" className="mb-1 block text-sm font-medium text-slate-700">
                Razón social <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Building2 size={18} className="absolute left-3 top-3.5 text-slate-400" />
                <input
                  id="client-business-name"
                  required
                  minLength={2}
                  maxLength={160}
                  autoFocus
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  placeholder="Distribuidora Norte S.A."
                  className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="client-first-name" className="mb-1 block text-sm font-medium text-slate-700">
                  Nombres <span className="text-red-500">*</span>
                </label>
                <input
                  id="client-first-name"
                  required
                  minLength={2}
                  maxLength={100}
                  autoFocus
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  placeholder="María Laura"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
              </div>
              <div>
                <label htmlFor="client-last-name" className="mb-1 block text-sm font-medium text-slate-700">
                  Apellidos <span className="text-red-500">*</span>
                </label>
                <input
                  id="client-last-name"
                  required
                  minLength={2}
                  maxLength={100}
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  placeholder="Gómez"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-slate-800">Datos opcionales</h3>
            <p className="mt-1 text-xs text-slate-500">Activa cada dato solamente cuando cuentes con esa información.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {clientType === 'individual' && (
                <OptionalField
                  id="client-document"
                  label="DNI"
                  enabled={hasDocumentNumber}
                  onEnabledChange={setHasDocumentNumber}
                >
                  <div className="relative">
                    <Fingerprint size={18} className="absolute left-3 top-3 text-slate-400" />
                    <input
                      required
                      inputMode="numeric"
                      pattern="[0-9]{7,8}"
                      minLength={7}
                      maxLength={8}
                      value={documentNumber}
                      onChange={(event) => setDocumentNumber(digitsOnly(event.target.value, 8))}
                      placeholder="12345678"
                      className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                </OptionalField>
              )}

              <OptionalField
                id="client-tax-id"
                label={clientType === 'company' ? 'CUIT' : 'CUIL'}
                enabled={hasTaxId}
                onEnabledChange={setHasTaxId}
              >
                <div className="relative">
                  <Fingerprint size={18} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]{11}"
                    minLength={11}
                    maxLength={11}
                    value={taxId}
                    onChange={(event) => setTaxId(digitsOnly(event.target.value, 11))}
                    placeholder="30712345678"
                    className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-[var(--color-primary)]"
                  />
                </div>
              </OptionalField>

              <OptionalField
                id="client-email"
                label="Correo electrónico"
                enabled={hasEmail}
                onEnabledChange={setHasEmail}
              >
                <div className="relative">
                  <Mail size={18} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    required
                    type="email"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    placeholder="contacto@cliente.com"
                    className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-[var(--color-primary)]"
                  />
                </div>
              </OptionalField>

              <OptionalField
                id="client-phone"
                label="Teléfono"
                enabled={hasPhone}
                onEnabledChange={setHasPhone}
              >
                <div className="relative">
                  <Phone size={18} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    required
                    type="tel"
                    maxLength={40}
                    value={contactPhone}
                    onChange={(event) => setContactPhone(event.target.value)}
                    placeholder="+54 11 5555-1234"
                    className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-[var(--color-primary)]"
                  />
                </div>
              </OptionalField>

              <div className="sm:col-span-2">
                <OptionalField
                  id="client-address"
                  label="Dirección"
                  enabled={hasAddress}
                  onEnabledChange={setHasAddress}
                >
                  <div className="relative">
                    <MapPin size={18} className="absolute left-3 top-3 text-slate-400" />
                    <input
                      required
                      maxLength={240}
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      placeholder="Av. Siempre Viva 123, CABA"
                      className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                </OptionalField>
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="client-status" className="mb-1 block text-sm font-medium text-slate-700">
              Estado
            </label>
            <select
              id="client-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as ClientStatus)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
            >
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-xl border border-slate-200 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              disabled={isSaving}
              className="rounded-xl bg-[var(--color-primary)] px-5 py-2.5 font-medium text-white shadow-sm shadow-[var(--color-primary)]/20 hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Guardando...' : client ? 'Guardar cambios' : 'Crear cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  Calculator,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Edit3,
  FilePlus2,
  Layers3,
  Plus,
  RefreshCw,
  Rocket,
  Scale,
  Settings2,
  Tags,
  X,
} from 'lucide-react';
import { getErrorMessage } from '../services/auth';
import {
  createRateCardDraft,
  getCompanyHolidays,
  getPricingWorkspace,
  publishRateCardVersion,
  saveEconomicConcept,
  saveCompanyHoliday,
  savePricingRule,
  saveRateCard,
  simulatePricing,
} from '../services/pricing';
import type {
  AppCurrency,
  CompanyHoliday,
  EconomicConceptCategory,
  Json,
  PricingCalculationType,
  PricingRule,
  PricingRuleInput,
  PricingScope,
  PricingSimulationInput,
  PricingSimulationResult,
  PricingTaxBehavior,
  PricingWorkspace,
  RateCard,
  RateCardVersion,
} from '../types';

interface PricingPageProps {
  canManage: boolean;
  locale: string;
}

const CATEGORY_PRESENTATION: Record<EconomicConceptCategory, { label: string; classes: string }> = {
  charge: { label: 'Cargo', classes: 'bg-blue-50 text-blue-700' },
  discount: { label: 'Descuento', classes: 'bg-emerald-50 text-emerald-700' },
  cost: { label: 'Costo interno', classes: 'bg-amber-50 text-amber-700' },
  commission: { label: 'Comisión', classes: 'bg-violet-50 text-violet-700' },
};

const EMPTY_SIMULATION: PricingSimulationInput = {
  clientId: '',
  zoneId: '',
  destinationPlaceId: '',
  packageCount: 1,
  weightKg: 0,
  volumeM3: 0,
  declaredValue: 0,
  distanceKm: 0,
  urgency: false,
  weekend: false,
};

const today = (): string => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};

const moneyFormatter = (locale: string, currency: AppCurrency) => new Intl.NumberFormat(locale, {
  style: 'currency',
  currency,
  maximumFractionDigits: 2,
});

interface ModalShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}

const ModalShell = ({ title, description, children, onClose, wide = false }: ModalShellProps) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button type="button" aria-label="Cerrar" onClick={onClose} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
    <div role="dialog" aria-modal="true" className={`relative max-h-[94vh] w-full overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}>
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-xl font-bold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button>
      </div>
      {children}
    </div>
  </div>
);

interface CardFormProps {
  card: RateCard | null;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (name: string, description: string, isActive: boolean) => Promise<void>;
}

const CardForm = ({ card, error, isSaving, onClose, onSave }: CardFormProps) => {
  const [name, setName] = useState(card?.name ?? 'Tarifa general');
  const [description, setDescription] = useState(card?.description ?? 'Valores generales para los movimientos de la empresa.');
  const [isActive, setIsActive] = useState(card?.isActive ?? true);
  return (
    <ModalShell title={card ? 'Editar lista tarifaria' : 'Nueva lista tarifaria'} description="Cada lista conserva versiones independientes y auditables." onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); void onSave(name, description, isActive); }} className="mt-6 space-y-4">
        <label className="block text-sm font-medium text-slate-700">Nombre<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[var(--color-primary)]" /></label>
        <label className="block text-sm font-medium text-slate-700">Descripción<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[var(--color-primary)]" /></label>
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="accent-[var(--color-primary)]" /> Lista habilitada</label>
        {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-slate-600">Cancelar</button><button disabled={isSaving} className="rounded-xl bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white disabled:opacity-60">{isSaving ? 'Guardando...' : 'Guardar lista'}</button></div>
      </form>
    </ModalShell>
  );
};

interface ConceptFormProps {
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (name: string, code: string, category: EconomicConceptCategory, description: string) => Promise<void>;
}

const ConceptForm = ({ error, isSaving, onClose, onSave }: ConceptFormProps) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState<EconomicConceptCategory>('charge');
  const [description, setDescription] = useState('');
  const normalizeCode = (value: string) => value.toLocaleLowerCase('es').replaceAll(/[^a-z0-9]+/g, '_').replaceAll(/^_+|_+$/g, '');
  return (
    <ModalShell title="Nuevo concepto económico" description="Los conceptos clasifican cada línea como cargo, descuento, costo o comisión." onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); void onSave(name, code, category, description); }} className="mt-6 space-y-4">
        <label className="block text-sm font-medium text-slate-700">Nombre<input required minLength={2} maxLength={100} value={name} onChange={(event) => { setName(event.target.value); if (!code) setCode(normalizeCode(event.target.value)); }} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
        <label className="block text-sm font-medium text-slate-700">Código estable<input required pattern="[a-z][a-z0-9_]{1,49}" value={code} onChange={(event) => setCode(normalizeCode(event.target.value))} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono" /><span className="mt-1 block text-xs text-slate-400">Se usa internamente y no debe cambiar después de crear reglas.</span></label>
        <label className="block text-sm font-medium text-slate-700">Categoría<select value={category} onChange={(event) => setCategory(event.target.value as EconomicConceptCategory)} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="charge">Cargo al cliente</option><option value="discount">Descuento al cliente</option><option value="cost">Costo interno</option><option value="commission">Comisión interna</option></select></label>
        <label className="block text-sm font-medium text-slate-700">Descripción<textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
        {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5">Cancelar</button><button disabled={isSaving} className="rounded-xl bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white disabled:opacity-60">Crear concepto</button></div>
      </form>
    </ModalShell>
  );
};

interface HolidayFormProps {
  holiday: CompanyHoliday | null;
  year: number;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (date: string, name: string, isActive: boolean) => Promise<void>;
}

const HolidayForm = ({ holiday, year, error, isSaving, onClose, onSave }: HolidayFormProps) => {
  const defaultDate = year === new Date().getFullYear() ? today() : `${year}-01-01`;
  const [date, setDate] = useState(holiday?.date ?? defaultDate);
  const [name, setName] = useState(holiday?.name ?? '');
  const [isActive, setIsActive] = useState(holiday?.isActive ?? true);

  return (
    <ModalShell title={holiday ? 'Editar feriado' : 'Nuevo feriado'} description="El calendario pertenece a tu empresa y quedará disponible para futuras reglas tarifarias." onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); void onSave(date, name, isActive); }} className="mt-6 space-y-4">
        <label className="block text-sm font-medium text-slate-700">Fecha<input required type="date" min="2000-01-01" max="2100-12-31" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5" /></label>
        <label className="block text-sm font-medium text-slate-700">Nombre<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Día de la Independencia" className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Feriado activo</label>
        {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5">Cancelar</button><button disabled={isSaving} className="rounded-xl bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white disabled:opacity-60">{isSaving ? 'Guardando...' : 'Guardar feriado'}</button></div>
      </form>
    </ModalShell>
  );
};

interface RuleFormProps {
  rule: PricingRule | null;
  version: RateCardVersion;
  workspace: PricingWorkspace;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: PricingRuleInput) => Promise<void>;
}

interface ScopeChecklistProps {
  label: string;
  emptyLabel: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
}

const ScopeChecklist = ({ label, emptyLabel, options, selected, onChange }: ScopeChecklistProps) => {
  const toggle = (id: string) => onChange(
    selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
  );
  return (
    <fieldset className="rounded-xl border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold text-slate-600">{label}</legend>
      <p className="mb-2 text-[10px] text-slate-400">{selected.length ? `${selected.length} seleccionados` : emptyLabel}</p>
      <div className="max-h-32 space-y-1 overflow-y-auto">
        {options.length ? options.map((option) => (
          <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
            <input type="checkbox" checked={selected.includes(option.id)} onChange={() => toggle(option.id)} />
            <span className="truncate">{option.label}</span>
          </label>
        )) : <span className="block px-2 py-2 text-xs text-slate-400">Sin opciones disponibles</span>}
      </div>
    </fieldset>
  );
};

const RuleForm = ({ rule, workspace, error, isSaving, onClose, onSave }: RuleFormProps) => {
  const activeConcepts = workspace.concepts.filter((concept) => concept.isActive);
  const formulaData = rule?.formula as { op?: string; args?: Array<{ name?: string; value?: number }> } | null;
  const [conceptId, setConceptId] = useState(rule?.conceptId ?? activeConcepts[0]?.id ?? '');
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const [calculationType, setCalculationType] = useState<PricingCalculationType>(rule?.calculationType ?? 'fixed');
  const [value, setValue] = useState(rule?.fixedAmount ?? rule?.percentage ?? formulaData?.args?.[1]?.value ?? 0);
  const [formulaVariable, setFormulaVariable] = useState(formulaData?.args?.[0]?.name ?? 'weight_kg');
  const [formulaOperator, setFormulaOperator] = useState(formulaData?.op ?? 'multiply');
  const [minimumAmount, setMinimumAmount] = useState<number | ''>(rule?.minimumAmount ?? '');
  const [maximumAmount, setMaximumAmount] = useState<number | ''>(rule?.maximumAmount ?? '');
  const [taxBehavior, setTaxBehavior] = useState<PricingTaxBehavior>(rule?.taxBehavior ?? 'none');
  const [taxRate, setTaxRate] = useState<number | ''>(rule?.taxRate ?? 21);
  const [taxLabel, setTaxLabel] = useState(rule?.taxLabel ?? 'IVA');
  const existingConditions = rule?.conditions as Record<string, Json> | undefined;
  const [urgentOnly, setUrgentOnly] = useState(existingConditions?.urgency === true);
  const [weekendOnly, setWeekendOnly] = useState(existingConditions?.weekend === true);
  const [clientType, setClientType] = useState(typeof existingConditions?.clientType === 'string' ? existingConditions.clientType : '');
  const [zoneType, setZoneType] = useState(typeof existingConditions?.zoneType === 'string' ? existingConditions.zoneType : '');
  const [minimumPackages, setMinimumPackages] = useState<number | ''>(typeof existingConditions?.minimumPackageCount === 'number' ? existingConditions.minimumPackageCount : '');
  const [minimumWeight, setMinimumWeight] = useState<number | ''>(typeof existingConditions?.minimumWeightKg === 'number' ? existingConditions.minimumWeightKg : '');
  const [minimumVolume, setMinimumVolume] = useState<number | ''>(typeof existingConditions?.minimumVolumeM3 === 'number' ? existingConditions.minimumVolumeM3 : '');
  const [minimumDeclaredValue, setMinimumDeclaredValue] = useState<number | ''>(typeof existingConditions?.minimumDeclaredValue === 'number' ? existingConditions.minimumDeclaredValue : '');
  const [minimumDistance, setMinimumDistance] = useState<number | ''>(typeof existingConditions?.minimumDistanceKm === 'number' ? existingConditions.minimumDistanceKm : '');
  const scopes = (type: PricingScope['type']) => rule?.scopes.filter((item) => item.type === type).map((item) => item.key) ?? [];
  const [clientIds, setClientIds] = useState(scopes('client'));
  const [zoneIds, setZoneIds] = useState(scopes('zone'));
  const [destinationIds, setDestinationIds] = useState(scopes('destination'));
  const [isCumulative, setIsCumulative] = useState(rule?.isCumulative ?? true);
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const selectedConcept = activeConcepts.find((concept) => concept.id === conceptId);
  const effectiveTaxBehavior = selectedConcept?.category === 'charge' ? taxBehavior : 'none';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const conditions: Record<string, Json> = {};
    if (urgentOnly) conditions.urgency = true;
    if (weekendOnly) conditions.weekend = true;
    if (clientType) conditions.clientType = clientType;
    if (zoneType) conditions.zoneType = zoneType;
    if (minimumPackages !== '') conditions.minimumPackageCount = minimumPackages;
    if (minimumWeight !== '') conditions.minimumWeightKg = minimumWeight;
    if (minimumVolume !== '') conditions.minimumVolumeM3 = minimumVolume;
    if (minimumDeclaredValue !== '') conditions.minimumDeclaredValue = minimumDeclaredValue;
    if (minimumDistance !== '') conditions.minimumDistanceKm = minimumDistance;
    const scopes: PricingScope[] = [];
    clientIds.forEach((key) => scopes.push({ type: 'client', key }));
    zoneIds.forEach((key) => scopes.push({ type: 'zone', key }));
    destinationIds.forEach((key) => scopes.push({ type: 'destination', key }));
    const formula: Json | null = calculationType === 'formula' ? {
      op: formulaOperator,
      args: [{ op: 'variable', name: formulaVariable }, { op: 'constant', value }],
    } : null;
    void onSave({
      conceptId,
      name,
      description,
      priority,
      calculationType,
      fixedAmount: calculationType === 'fixed' ? value : null,
      percentage: calculationType === 'percentage' ? value : null,
      formula,
      minimumAmount: minimumAmount === '' ? null : minimumAmount,
      maximumAmount: maximumAmount === '' ? null : maximumAmount,
      taxBehavior: effectiveTaxBehavior,
      taxRate: effectiveTaxBehavior === 'none' || taxRate === '' ? null : taxRate,
      taxLabel: effectiveTaxBehavior === 'none' ? null : taxLabel.trim(),
      conditions,
      isCumulative,
      isActive,
      scopes,
    });
  };

  return (
    <ModalShell wide title={rule ? 'Editar regla' : 'Nueva regla económica'} description="Las reglas se ejecutan por prioridad y explican cada importe del simulador." onClose={onClose}>
      <form onSubmit={submit} className="mt-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Concepto<select required value={conceptId} onChange={(event) => setConceptId(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5">{activeConcepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}</select></label><label className="text-sm font-medium text-slate-700">Prioridad<input type="number" min={1} max={10000} value={priority} onChange={(event) => setPriority(Number(event.target.value))} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label></div>
        <label className="block text-sm font-medium text-slate-700">Nombre de la regla<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Precio base AMBA" className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
        <label className="block text-sm font-medium text-slate-700">Descripción<textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
        <div className="rounded-2xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-800">Cálculo</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">{([['fixed', 'Importe fijo'], ['percentage', '% del subtotal'], ['formula', 'Fórmula segura']] as const).map(([type, label]) => <button key={type} type="button" onClick={() => setCalculationType(type)} className={`rounded-xl border px-3 py-2 text-sm font-medium ${calculationType === type ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]' : 'border-slate-200 text-slate-500'}`}>{label}</button>)}</div>
          {calculationType === 'formula' && (
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_11rem_1fr]">
              <label className="text-xs font-medium text-slate-600">Variable<select value={formulaVariable} onChange={(event) => setFormulaVariable(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="package_count">Cantidad de paquetes</option><option value="weight_kg">Peso (kg)</option><option value="volume_m3">Volumen (m³)</option><option value="declared_value">Valor declarado</option><option value="distance_km">Distancia (km)</option><option value="subtotal">Subtotal acumulado</option><option value="base_price">Precio base acumulado</option><option value="urgency_flag">Es urgente (1/0)</option><option value="weekend_flag">Es fin de semana (1/0)</option><option value="client_is_company">Cliente empresa (1/0)</option></select></label>
              <label className="text-xs font-medium text-slate-600">Operación<select value={formulaOperator} onChange={(event) => setFormulaOperator(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="add">Sumar</option><option value="subtract">Restar</option><option value="multiply">Multiplicar</option><option value="divide">Dividir</option><option value="min">Tomar mínimo</option><option value="max">Tomar máximo</option></select></label>
              <label className="text-xs font-medium text-slate-600">Constante<input required type="number" step="0.0001" value={value} onChange={(event) => setValue(Number(event.target.value))} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label>
            </div>
          )}
          {calculationType !== 'formula' && <label className="mt-4 block text-sm font-medium text-slate-700">{calculationType === 'fixed' ? 'Importe' : 'Porcentaje'}<input required type="number" min={0} step="0.0001" value={value} onChange={(event) => setValue(Number(event.target.value))} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm text-slate-600">Mínimo opcional<input type="number" min={0} step="0.01" value={minimumAmount} onChange={(event) => setMinimumAmount(event.target.value ? Number(event.target.value) : '')} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label><label className="text-sm text-slate-600">Máximo opcional<input type="number" min={0} step="0.01" value={maximumAmount} onChange={(event) => setMaximumAmount(event.target.value ? Number(event.target.value) : '')} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label></div>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-800">Tratamiento impositivo</h3>
          <p className="mt-1 text-xs text-slate-500">Se congela junto con la versión y se desglosa en cada movimiento valorizado.</p>
          {selectedConcept?.category === 'charge' ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-medium text-slate-600">Modalidad<select value={taxBehavior} onChange={(event) => setTaxBehavior(event.target.value as PricingTaxBehavior)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="none">Sin impuesto</option><option value="included">Incluido en el importe</option><option value="added">Adicionar al importe</option></select></label>
              <label className="text-xs font-medium text-slate-600">Alícuota (%)<input disabled={taxBehavior === 'none'} required={taxBehavior !== 'none'} type="number" min={0.0001} max={100} step="0.0001" value={taxRate} onChange={(event) => setTaxRate(event.target.value ? Number(event.target.value) : '')} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm disabled:opacity-50" /></label>
              <label className="text-xs font-medium text-slate-600">Etiqueta<input disabled={taxBehavior === 'none'} required={taxBehavior !== 'none'} minLength={2} maxLength={60} value={taxLabel} onChange={(event) => setTaxLabel(event.target.value)} placeholder="IVA" className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm disabled:opacity-50" /></label>
            </div>
          ) : <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">Los impuestos sólo se aplican a conceptos de cargo al cliente.</p>}
        </div>
        <div className="rounded-2xl border border-slate-200 p-4"><h3 className="font-semibold text-slate-800">Alcance opcional</h3><p className="mt-1 text-xs text-slate-500">Sin selección, la regla aplica globalmente. Dentro de un tipo basta que coincida una opción; entre tipos deben coincidir todos.</p><div className="mt-3 grid gap-3 md:grid-cols-3"><ScopeChecklist label="Clientes" emptyLabel="Todos los clientes" options={workspace.clients} selected={clientIds} onChange={setClientIds} /><ScopeChecklist label="Zonas" emptyLabel="Todas las zonas" options={workspace.zones} selected={zoneIds} onChange={setZoneIds} /><ScopeChecklist label="Destinos" emptyLabel="Todos los destinos" options={workspace.destinations} selected={destinationIds} onChange={setDestinationIds} /></div></div>
        <div className="rounded-2xl border border-slate-200 p-4"><h3 className="font-semibold text-slate-800">Condiciones</h3><p className="mt-1 text-xs text-slate-500">Todas las condiciones configuradas deben cumplirse para aplicar la regla.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="flex items-center gap-2 self-end rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-600"><input type="checkbox" checked={urgentOnly} onChange={(event) => setUrgentOnly(event.target.checked)} /> Sólo servicios urgentes</label><label className="flex items-center gap-2 self-end rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-600"><input type="checkbox" checked={weekendOnly} onChange={(event) => setWeekendOnly(event.target.checked)} /> Sólo fines de semana</label><label className="text-xs font-medium text-slate-600">Tipo de cliente<select value={clientType} onChange={(event) => setClientType(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">Cualquier tipo</option><option value="company">Empresa</option><option value="individual">Individuo</option></select></label><label className="text-xs font-medium text-slate-600">Tipo de zona<select value={zoneType} onChange={(event) => setZoneType(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">Cualquier tipo</option><option value="group">Grupo de cobertura</option><option value="city">Ciudad individual</option></select></label><label className="text-xs font-medium text-slate-600">Paquetes mínimos<input type="number" min={0} step={1} value={minimumPackages} onChange={(event) => setMinimumPackages(event.target.value ? Number(event.target.value) : '')} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-medium text-slate-600">Peso mínimo (kg)<input type="number" min={0} step="0.01" value={minimumWeight} onChange={(event) => setMinimumWeight(event.target.value ? Number(event.target.value) : '')} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-medium text-slate-600">Volumen mínimo (m³)<input type="number" min={0} step="0.0001" value={minimumVolume} onChange={(event) => setMinimumVolume(event.target.value ? Number(event.target.value) : '')} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-medium text-slate-600">Valor declarado mínimo<input type="number" min={0} step="0.01" value={minimumDeclaredValue} onChange={(event) => setMinimumDeclaredValue(event.target.value ? Number(event.target.value) : '')} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-medium text-slate-600">Distancia mínima (km)<input type="number" min={0} step="0.01" value={minimumDistance} onChange={(event) => setMinimumDistance(event.target.value ? Number(event.target.value) : '')} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label></div></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Regla activa en esta versión</label><label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700"><input type="checkbox" checked={isCumulative} onChange={(event) => setIsCumulative(event.target.checked)} /> Continuar con reglas posteriores</label></div>
        {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5">Cancelar</button><button disabled={isSaving || !conceptId} className="rounded-xl bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white disabled:opacity-60">{isSaving ? 'Guardando...' : 'Guardar regla'}</button></div>
      </form>
    </ModalShell>
  );
};

export const PricingPage = ({ canManage, locale }: PricingPageProps) => {
  const [workspace, setWorkspace] = useState<PricingWorkspace | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
  const [holidayForm, setHolidayForm] = useState<CompanyHoliday | null | 'new'>(null);
  const [holidayError, setHolidayError] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cardForm, setCardForm] = useState<RateCard | null | 'new'>(null);
  const [conceptFormOpen, setConceptFormOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState<PricingRule | null | 'new'>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [simulationInput, setSimulationInput] = useState<PricingSimulationInput>(EMPTY_SIMULATION);
  const [simulation, setSimulation] = useState<PricingSimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [effectiveTo, setEffectiveTo] = useState('');
  const [publishCurrency, setPublishCurrency] = useState<AppCurrency>('ARS');
  const [publishNotes, setPublishNotes] = useState('');

  const loadWorkspace = async (preferredCardId?: string, preferredVersionId?: string) => {
    setIsLoading(true);
    try {
      const data = await getPricingWorkspace();
      setWorkspace(data);
      const cardId = preferredCardId ?? selectedCardId ?? data.rateCards[0]?.id ?? '';
      const card = data.rateCards.find((item) => item.id === cardId) ?? data.rateCards[0];
      const versionId = preferredVersionId ?? card?.versions.find((version) => version.status === 'draft')?.id ?? card?.versions[0]?.id ?? '';
      setSelectedCardId(card?.id ?? '');
      setSelectedVersionId(versionId);
      setPublishCurrency(data.currency);
      setError(null);
    } catch (caughtError: unknown) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isCancelled = false;
    void getPricingWorkspace()
      .then((data) => {
        if (isCancelled) return;
        const card = data.rateCards[0];
        const version = card?.versions.find((item) => item.status === 'draft') ?? card?.versions[0];
        setWorkspace(data);
        setSelectedCardId(card?.id ?? '');
        setSelectedVersionId(version?.id ?? '');
        setPublishCurrency(data.currency);
        setError(null);
      })
      .catch((caughtError: unknown) => {
        if (!isCancelled) setError(getErrorMessage(caughtError));
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    return () => { isCancelled = true; };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    void getCompanyHolidays(holidayYear)
      .then((data) => {
        if (!isCancelled) {
          setHolidays(data);
          setHolidayError(null);
        }
      })
      .catch((caughtError: unknown) => {
        if (!isCancelled) setHolidayError(getErrorMessage(caughtError));
      });
    return () => { isCancelled = true; };
  }, [holidayYear]);

  const selectedCard = workspace?.rateCards.find((card) => card.id === selectedCardId) ?? null;
  const selectedVersion = selectedCard?.versions.find((version) => version.id === selectedVersionId) ?? null;
  const draftVersion = selectedCard?.versions.find((version) => version.status === 'draft') ?? null;
  const currentPublishedVersion = selectedCard?.versions.find((version) => version.status === 'published') ?? null;
  const formatter = useMemo(() => moneyFormatter(locale, simulation?.currency ?? workspace?.currency ?? 'ARS'), [locale, simulation?.currency, workspace?.currency]);

  const saveCardForm = async (name: string, description: string, isActive: boolean) => {
    setIsSaving(true); setFormError(null);
    try {
      const cardId = await saveRateCard(cardForm === 'new' ? null : cardForm?.id ?? null, { name, description, isActive });
      setCardForm(null); setNotice('Lista tarifaria guardada.');
      await loadWorkspace(cardId);
    } catch (caughtError: unknown) { setFormError(getErrorMessage(caughtError)); } finally { setIsSaving(false); }
  };

  const saveConceptForm = async (name: string, code: string, category: EconomicConceptCategory, description: string) => {
    setIsSaving(true); setFormError(null);
    try {
      await saveEconomicConcept(null, { name, code, category, description, isActive: true });
      setConceptFormOpen(false); setNotice('Concepto económico creado.'); await loadWorkspace(selectedCardId, selectedVersionId);
    } catch (caughtError: unknown) { setFormError(getErrorMessage(caughtError)); } finally { setIsSaving(false); }
  };

  const saveHolidayForm = async (date: string, name: string, isActive: boolean) => {
    setIsSaving(true); setFormError(null);
    try {
      await saveCompanyHoliday(holidayForm === 'new' ? null : holidayForm?.id ?? null, { date, name, isActive });
      const savedYear = Number(date.slice(0, 4));
      setHolidayForm(null);
      setHolidayYear(savedYear);
      setHolidays(await getCompanyHolidays(savedYear));
      setHolidayError(null);
      setNotice('Calendario de feriados actualizado.');
    } catch (caughtError: unknown) { setFormError(getErrorMessage(caughtError)); } finally { setIsSaving(false); }
  };

  const saveRuleForm = async (input: PricingRuleInput) => {
    if (!draftVersion) return;
    setIsSaving(true); setFormError(null);
    try {
      await savePricingRule(ruleForm === 'new' ? null : ruleForm?.id ?? null, draftVersion.id, input);
      setRuleForm(null); setNotice('Regla económica guardada.'); await loadWorkspace(selectedCardId, draftVersion.id);
    } catch (caughtError: unknown) { setFormError(getErrorMessage(caughtError)); } finally { setIsSaving(false); }
  };

  const createDraft = async () => {
    if (!selectedCard) return;
    setIsSaving(true); setError(null);
    try { const versionId = await createRateCardDraft(selectedCard.id); setNotice('Nueva versión borrador creada.'); await loadWorkspace(selectedCard.id, versionId); }
    catch (caughtError: unknown) { setError(getErrorMessage(caughtError)); } finally { setIsSaving(false); }
  };

  const publishDraft = async () => {
    if (!draftVersion) return;
    setIsSaving(true); setFormError(null);
    try {
      await publishRateCardVersion(draftVersion.id, effectiveFrom, effectiveTo, publishCurrency, publishNotes);
      setPublishOpen(false); setNotice(`Versión ${draftVersion.versionNumber} publicada.`); await loadWorkspace(selectedCardId, draftVersion.id);
    } catch (caughtError: unknown) { setFormError(getErrorMessage(caughtError)); } finally { setIsSaving(false); }
  };

  const runSimulation = async () => {
    if (!selectedVersion) return;
    setIsSimulating(true); setError(null);
    try { setSimulation(await simulatePricing(selectedVersion.id, simulationInput)); }
    catch (caughtError: unknown) { setError(getErrorMessage(caughtError)); } finally { setIsSimulating(false); }
  };

  if (isLoading && !workspace) return <div className="flex h-64 items-center justify-center"><RefreshCw className="animate-spin text-[var(--color-primary)]" /></div>;
  if (error && !workspace) return <div className="rounded-2xl border border-red-100 bg-white p-8 text-center"><AlertCircle className="mx-auto text-red-500" size={36} /><h1 className="mt-4 font-bold">No pudimos cargar los valores económicos</h1><p className="mt-2 text-sm text-slate-500">{error}</p><button type="button" onClick={() => void loadWorkspace()} className="mt-5 rounded-xl bg-[var(--color-primary)] px-4 py-2 text-white">Reintentar</button></div>;
  if (!workspace) return null;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-bold text-slate-900">Valores económicos</h1><p className="mt-1 text-slate-500">Crea tarifas versionadas y comprueba cada cálculo antes de publicarlo.</p></div>{canManage && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setFormError(null); setHolidayForm('new'); }} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"><CalendarDays size={17} /> Feriado</button><button type="button" onClick={() => { setFormError(null); setConceptFormOpen(true); }} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"><Tags size={17} /> Concepto</button><button type="button" onClick={() => { setFormError(null); setCardForm('new'); }} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 text-sm font-medium text-white"><Plus size={17} /> Lista tarifaria</button></div>}</div>
      {notice && <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span className="flex items-center gap-2"><CheckCircle2 size={17} /> {notice}</span><button type="button" onClick={() => setNotice(null)}><X size={16} /></button></div>}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {workspace.rateCards.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center"><CircleDollarSign size={46} className="mx-auto text-[var(--color-primary)]" /><h2 className="mt-4 text-xl font-bold text-slate-900">Crea tu primera lista tarifaria</h2><p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">Comenzará como borrador. Podrás agregar precios base, recargos, descuentos, costos y comisiones antes de publicarla.</p>{canManage && <button type="button" onClick={() => setCardForm('new')} className="mt-5 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white">Crear lista</button>}</div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="space-y-4"><div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Listas tarifarias</p>{workspace.rateCards.map((card) => <button key={card.id} type="button" onClick={() => { setSelectedCardId(card.id); const version = card.versions.find((item) => item.status === 'draft') ?? card.versions[0]; setSelectedVersionId(version?.id ?? ''); setSimulation(null); }} className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-3 text-left ${selectedCardId === card.id ? 'bg-[var(--color-primary)] text-white' : 'text-slate-600 hover:bg-slate-50'}`}><span><span className="block font-semibold">{card.name}</span><span className={`text-xs ${selectedCardId === card.id ? 'text-white/70' : 'text-slate-400'}`}>{card.versions.length} versiones</span></span><ChevronRight size={17} /></button>)}</div><div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold text-slate-900"><Tags size={17} /> Conceptos</h2><span className="text-xs text-slate-400">{workspace.concepts.filter((item) => item.isActive).length}</span></div><div className="mt-3 max-h-72 space-y-2 overflow-y-auto">{workspace.concepts.filter((item) => item.isActive).map((concept) => <div key={concept.id} className="rounded-lg border border-slate-100 px-3 py-2"><p className="text-sm font-medium text-slate-700">{concept.name}</p><span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${CATEGORY_PRESENTATION[concept.category].classes}`}>{CATEGORY_PRESENTATION[concept.category].label}</span></div>)}</div></div></aside>

          {selectedCard && selectedVersion ? <div className="space-y-6"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h2 className="text-xl font-bold text-slate-900">{selectedCard.name}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${selectedVersion.status === 'draft' ? 'bg-amber-50 text-amber-700' : selectedVersion.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{selectedVersion.status === 'draft' ? 'Borrador' : selectedVersion.status === 'published' ? 'Publicada' : 'Retirada'}</span></div><p className="mt-1 text-sm text-slate-500">{selectedCard.description || 'Sin descripción'}</p></div>{canManage && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setCardForm(selectedCard)} className="rounded-lg border border-slate-200 p-2 text-slate-500"><Edit3 size={17} /></button>{!draftVersion && <button type="button" disabled={isSaving} onClick={() => void createDraft()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600"><FilePlus2 size={16} /> Nueva versión</button>}{draftVersion && <button type="button" onClick={() => { setFormError(null); setPublishOpen(true); }} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"><Rocket size={16} /> Publicar</button>}</div>}</div><div className="mt-5 flex flex-wrap items-end gap-4"><label className="text-xs font-medium text-slate-500">Versión<select value={selectedVersionId} onChange={(event) => { setSelectedVersionId(event.target.value); setSimulation(null); }} className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">{selectedCard.versions.map((version) => <option key={version.id} value={version.id}>v{version.versionNumber} · {version.status === 'draft' ? 'Borrador' : version.status === 'published' ? 'Publicada' : 'Retirada'}</option>)}</select></label><div className="text-xs text-slate-500"><span className="block font-medium">Moneda</span><span className="mt-1 block text-sm font-semibold text-slate-700">{selectedVersion.currency}</span></div>{selectedVersion.effectiveFrom && <div className="text-xs text-slate-500"><span className="block font-medium">Vigencia</span><span className="mt-1 block text-sm text-slate-700">{selectedVersion.effectiveFrom} → {selectedVersion.effectiveTo || 'sin fin'}</span></div>}</div></section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-bold text-slate-900"><Layers3 size={18} className="text-[var(--color-primary)]" /> Reglas de la versión</h2><p className="mt-1 text-xs text-slate-500">Se calculan en orden de prioridad.</p></div>{canManage && selectedVersion.status === 'draft' && <button type="button" onClick={() => { setFormError(null); setRuleForm('new'); }} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white"><Plus size={16} /> Regla</button>}</div><div className="mt-4 space-y-3">{selectedVersion.rules.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">Este borrador todavía no tiene reglas.</div> : selectedVersion.rules.map((rule) => { const concept = workspace.concepts.find((item) => item.id === rule.conceptId); return <article key={rule.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-500">{rule.priority}</span><h3 className="font-semibold text-slate-800">{rule.name}</h3>{concept && <span className={`rounded-full px-2 py-0.5 text-[10px] ${CATEGORY_PRESENTATION[concept.category].classes}`}>{CATEGORY_PRESENTATION[concept.category].label}</span>}{rule.taxBehavior !== 'none' && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700">{rule.taxLabel} {rule.taxRate}% {rule.taxBehavior === 'included' ? 'incluido' : 'adicionado'}</span>}{!rule.isCumulative && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">Exclusiva</span>}</div><p className="mt-1 text-xs text-slate-500">{rule.calculationType === 'fixed' ? formatter.format(rule.fixedAmount ?? 0) : rule.calculationType === 'percentage' ? `${rule.percentage}% del subtotal` : 'Fórmula segura'}{rule.scopes.length ? ` · ${rule.scopes.length} alcances` : ' · Global'}</p></div>{canManage && selectedVersion.status === 'draft' && <button type="button" onClick={() => { setFormError(null); setRuleForm(rule); }} className="self-end rounded-lg border border-slate-200 p-2 text-slate-500 sm:self-auto"><Edit3 size={16} /></button>}</article>; })}</div></section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><h2 className="flex items-center gap-2 font-bold text-slate-900"><Calculator size={19} className="text-[var(--color-primary)]" /> Simulador explicable</h2><p className="mt-1 text-sm text-slate-500">Usa exactamente el mismo motor y versión que luego calcularán los movimientos.</p></div><div className="mt-5 grid gap-5 lg:grid-cols-2"><div className="grid gap-3 sm:grid-cols-2"><select aria-label="Cliente de simulación" value={simulationInput.clientId} onChange={(event) => setSimulationInput({ ...simulationInput, clientId: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">Cliente no especificado</option>{workspace.clients.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><select aria-label="Zona de simulación" value={simulationInput.zoneId} onChange={(event) => setSimulationInput({ ...simulationInput, zoneId: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">Zona no especificada</option>{workspace.zones.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><select aria-label="Destino de simulación" value={simulationInput.destinationPlaceId} onChange={(event) => setSimulationInput({ ...simulationInput, destinationPlaceId: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm sm:col-span-2"><option value="">Destino no especificado</option>{workspace.destinations.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>{([['packageCount', 'Paquetes'], ['weightKg', 'Peso (kg)'], ['volumeM3', 'Volumen (m³)'], ['declaredValue', 'Valor declarado'], ['distanceKm', 'Distancia (km)']] as const).map(([key, label]) => <label key={key} className="text-xs text-slate-500">{label}<input type="number" min={0} step={key === 'packageCount' ? 1 : 0.01} value={simulationInput[key]} onChange={(event) => setSimulationInput({ ...simulationInput, [key]: Number(event.target.value) })} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700" /></label>)}<div className="flex flex-col gap-2 pt-5 text-sm text-slate-600"><label className="flex items-center gap-2"><input type="checkbox" checked={simulationInput.urgency} onChange={(event) => setSimulationInput({ ...simulationInput, urgency: event.target.checked })} /> Urgente</label><label className="flex items-center gap-2"><input type="checkbox" checked={simulationInput.weekend} onChange={(event) => setSimulationInput({ ...simulationInput, weekend: event.target.checked })} /> Fin de semana</label></div><button type="button" disabled={isSimulating || selectedVersion.rules.length === 0} onClick={() => void runSimulation()} className="sm:col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white disabled:opacity-50">{isSimulating ? <RefreshCw size={17} className="animate-spin" /> : <Calculator size={17} />} Calcular</button></div><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">{simulation ? <><div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-4"><div><p className="text-xs uppercase tracking-wider text-slate-400">Total al cliente</p><p className="mt-1 text-3xl font-bold text-slate-900">{formatter.format(simulation.customerTotal)}</p><p className="mt-1 text-xs text-slate-500">Impuestos identificados: {formatter.format(simulation.taxTotal)}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">v{simulation.versionNumber}</span></div><div className="mt-4 space-y-2">{simulation.lineItems.map((line) => <div key={line.ruleId} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0"><span className="block truncate font-medium text-slate-700">{line.ruleName}</span><span className="text-xs text-slate-400">{line.conceptName}{line.taxBehavior !== 'none' ? ` · ${line.taxLabel} ${line.taxRate}% ${line.taxBehavior === 'included' ? 'incluido' : 'adicionado'}` : ''}</span></span><span className={line.amount < 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-slate-700'}>{formatter.format(line.amount)}</span></div>)}</div><div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-200 pt-4 text-xs text-slate-500"><span>Descuentos <strong className="block text-sm text-emerald-600">{formatter.format(simulation.discountTotal)}</strong></span><span>Costos internos <strong className="block text-sm text-amber-600">{formatter.format(simulation.internalCostTotal)}</strong></span><span>Comisiones <strong className="block text-sm text-violet-600">{formatter.format(simulation.commissionTotal)}</strong></span><span>Cargos <strong className="block text-sm text-slate-700">{formatter.format(simulation.chargeTotal)}</strong></span><span>Impuesto incluido <strong className="block text-sm text-violet-600">{formatter.format(simulation.includedTaxTotal)}</strong></span><span>Impuesto adicionado <strong className="block text-sm text-violet-600">{formatter.format(simulation.addedTaxTotal)}</strong></span></div></> : <div className="flex h-full min-h-64 flex-col items-center justify-center text-center"><Scale size={36} className="text-slate-300" /><p className="mt-3 font-medium text-slate-600">Completa los datos y calcula</p><p className="mt-1 max-w-xs text-xs text-slate-400">Aquí aparecerán las reglas aplicadas y cada importe.</p></div>}</div></div></section>
          </div> : <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">Selecciona una versión.</div>}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="flex items-center gap-2 font-bold text-slate-900"><CalendarDays size={19} className="text-[var(--color-primary)]" /> Calendario de feriados</h2><p className="mt-1 text-xs text-slate-500">Fechas propias de la empresa. En el próximo incremento podrán activar condiciones y fórmulas tarifarias.</p></div>
          <label className="text-xs font-medium text-slate-500">Año<select value={holidayYear} onChange={(event) => setHolidayYear(Number(event.target.value))} className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">{Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - 2 + index).map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
        </div>
        {holidayError ? <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{holidayError}</div> : holidays.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-5 py-8 text-center"><p className="text-sm font-medium text-slate-600">No hay feriados configurados para {holidayYear}.</p>{canManage && <button type="button" onClick={() => { setFormError(null); setHolidayForm('new'); }} className="mt-3 text-sm font-semibold text-[var(--color-primary)]">Agregar el primero</button>}</div> : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{holidays.map((holiday) => <button key={holiday.id} type="button" disabled={!canManage} onClick={() => { setFormError(null); setHolidayForm(holiday); }} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left disabled:cursor-default"><span><span className="block text-sm font-semibold text-slate-800">{holiday.name}</span><span className="mt-0.5 block text-xs text-slate-400">{new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long' }).format(new Date(`${holiday.date}T12:00:00`))}</span></span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${holiday.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{holiday.isActive ? 'Activo' : 'Inactivo'}</span></button>)}</div>}
      </section>

      {cardForm && <CardForm card={cardForm === 'new' ? null : cardForm} error={formError} isSaving={isSaving} onClose={() => setCardForm(null)} onSave={saveCardForm} />}
      {holidayForm && <HolidayForm holiday={holidayForm === 'new' ? null : holidayForm} year={holidayYear} error={formError} isSaving={isSaving} onClose={() => setHolidayForm(null)} onSave={saveHolidayForm} />}
      {conceptFormOpen && <ConceptForm error={formError} isSaving={isSaving} onClose={() => setConceptFormOpen(false)} onSave={saveConceptForm} />}
      {ruleForm && draftVersion && <RuleForm rule={ruleForm === 'new' ? null : ruleForm} version={draftVersion} workspace={workspace} error={formError} isSaving={isSaving} onClose={() => setRuleForm(null)} onSave={saveRuleForm} />}
      {publishOpen && draftVersion && (
        <ModalShell
          title={`Publicar versión ${draftVersion.versionNumber}`}
          description="La versión quedará inmutable y su período determinará qué tarifa corresponde aplicar."
          onClose={() => setPublishOpen(false)}
        >
          <div className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                Vigente desde
                <input required type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5" />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Hasta (opcional)
                <input type="date" min={effectiveFrom} value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5" />
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Moneda
              <select value={publishCurrency} onChange={(event) => setPublishCurrency(event.target.value as AppCurrency)} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <option value="ARS">ARS</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="BRL">BRL</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Notas
              <textarea rows={2} value={publishNotes} onChange={(event) => setPublishNotes(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5" />
            </label>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
              <Settings2 size={16} className="mb-1" />
              {currentPublishedVersion
                ? `La versión ${currentPublishedVersion.versionNumber} se cerrará automáticamente al comenzar esta vigencia. Si ambas comienzan el mismo día, quedará retirada.`
                : 'Después de publicar, crea una nueva versión para cambiar las reglas.'}
            </div>
            {formError && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setPublishOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5">Cancelar</button>
              <button type="button" disabled={isSaving || !effectiveFrom} onClick={() => void publishDraft()} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 font-medium text-white disabled:opacity-60"><Rocket size={16} /> {isSaving ? 'Publicando...' : 'Publicar versión'}</button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
};

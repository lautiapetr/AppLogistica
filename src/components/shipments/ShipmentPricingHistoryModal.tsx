import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { CircleDollarSign, History, Plus, ReceiptText, RefreshCw, X } from 'lucide-react';
import {
  applyShipmentPricingAdjustment,
  getShipmentPricingHistory,
} from '../../services/shipments';
import type {
  AppCurrency,
  EconomicConceptCategory,
  ShipmentPricingHistory,
  ShipmentRecord,
} from '../../types';

interface ShipmentPricingHistoryModalProps {
  shipment: ShipmentRecord;
  canManage: boolean;
  onClose: () => void;
  onAdjusted: () => void;
}

const REASON_LABELS: Record<string, string> = {
  creation: 'Cálculo inicial',
  movement_update: 'Actualización del movimiento',
  manual_recalculation: 'Recálculo manual',
  manual_adjustment: 'Ajuste manual',
};

const CATEGORY_LABELS: Record<EconomicConceptCategory, string> = {
  charge: 'Cargo al cliente',
  discount: 'Descuento',
  cost: 'Costo interno',
  commission: 'Comisión',
};

const formatMoney = (amount: number, currency: AppCurrency) => new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency,
}).format(amount);

const formatDateTime = (value: string) => new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
}).format(new Date(value));

export const ShipmentPricingHistoryModal = ({
  shipment,
  canManage,
  onClose,
  onAdjusted,
}: ShipmentPricingHistoryModalProps) => {
  const [history, setHistory] = useState<ShipmentPricingHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conceptId, setConceptId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadHistory = async () => {
    try {
      const data = await getShipmentPricingHistory(shipment.id);
      setHistory(data);
      setConceptId((current) => current || data.concepts[0]?.id || '');
      setLoadError(null);
    } catch (caughtError: unknown) {
      setLoadError(caughtError instanceof Error ? caughtError.message : 'No pudimos cargar el historial económico.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isCancelled = false;
    void getShipmentPricingHistory(shipment.id)
      .then((data) => {
        if (isCancelled) return;
        setHistory(data);
        setConceptId(data.concepts[0]?.id ?? '');
        setLoadError(null);
      })
      .catch((caughtError: unknown) => {
        if (!isCancelled) setLoadError(caughtError instanceof Error ? caughtError.message : 'No pudimos cargar el historial económico.');
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    return () => { isCancelled = true; };
  }, [shipment.id]);

  const submitAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!conceptId || !Number.isFinite(numericAmount) || numericAmount <= 0) return;

    setIsSaving(true);
    setFormError(null);
    try {
      await applyShipmentPricingAdjustment(shipment.id, conceptId, numericAmount, reason);
      setAmount('');
      setReason('');
      setIsLoading(true);
      await loadHistory();
      onAdjusted();
    } catch (caughtError: unknown) {
      setFormError(caughtError instanceof Error ? caughtError.message : 'No pudimos aplicar el ajuste.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cerrar historial" onClick={onClose} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" aria-labelledby="pricing-history-title" className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[var(--color-primary)]"><ReceiptText size={18} /><span className="text-xs font-semibold uppercase tracking-wider">Detalle económico</span></div>
            <h2 id="pricing-history-title" className="mt-2 text-xl font-bold text-slate-900">{shipment.tracking_number}</h2>
            <p className="mt-1 text-sm text-slate-400">Cada revisión conserva sus importes y líneas originales.</p>
          </div>
          <button type="button" aria-label="Cerrar" disabled={isSaving} onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={20} /></button>
        </div>

        {isLoading ? (
          <div className="flex h-52 items-center justify-center"><RefreshCw className="animate-spin text-[var(--color-primary)]" /></div>
        ) : loadError ? (
          <div className="mt-6 rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{loadError}</div>
        ) : history ? (
          <div className="mt-6 space-y-5">
            {canManage && history.calculations.length > 0 && (
              <form onSubmit={(event) => void submitAdjustment(event)} className="rounded-2xl border border-violet-100 bg-violet-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--color-primary)]"><Plus size={18} /></div>
                  <div><h3 className="font-semibold text-slate-800">Nuevo ajuste manual</h3><p className="mt-0.5 text-xs text-slate-400">Creará una revisión nueva; el cálculo actual no será modificado.</p></div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-slate-600">Concepto<select required value={conceptId} onChange={(event) => setConceptId(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">Seleccionar concepto</option>{history.concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.name} · {CATEGORY_LABELS[concept.category]}</option>)}</select></label>
                  <label className="text-xs font-medium text-slate-600">Importe<input required type="number" min={0.01} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" /></label>
                  <label className="text-xs font-medium text-slate-600 sm:col-span-2">Motivo<textarea required minLength={5} maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explica por qué se realiza este ajuste..." className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" /></label>
                </div>
                {formError && <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</div>}
                <div className="mt-3 flex justify-end"><button disabled={isSaving || !conceptId || !amount || reason.trim().length < 5} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><CircleDollarSign size={16} />{isSaving ? 'Aplicando...' : 'Aplicar ajuste'}</button></div>
              </form>
            )}

            <div className="space-y-3">
              {history.calculations.map((calculation) => (
                <details key={calculation.id} open={calculation.isCurrent} className="group rounded-2xl border border-slate-200 bg-white p-4">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${calculation.isCurrent ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}><History size={17} /></div>
                      <div><div className="flex items-center gap-2"><h3 className="font-semibold text-slate-800">Revisión {calculation.sequence}</h3>{calculation.isCurrent && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Actual</span>}</div><p className="text-xs text-slate-400">{REASON_LABELS[calculation.reason] ?? calculation.reason} · {formatDateTime(calculation.calculatedAt)}</p></div>
                    </div>
                    <div className="text-right"><p className="font-bold text-slate-900">{formatMoney(calculation.customerTotal, calculation.currency)}</p><p className="text-[10px] text-slate-400">{calculation.rateCardName} · v{calculation.versionNumber}</p></div>
                  </summary>
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <div className="space-y-2">
                      {calculation.lineItems.map((line) => (
                        <div key={line.lineNumber} className={`rounded-xl border p-3 ${line.isManual ? 'border-violet-100 bg-violet-50' : 'border-slate-100'}`}>
                          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-700">{line.ruleName}</p><p className="text-xs text-slate-400">{line.conceptName}{line.isManual ? ' · Manual' : ''}{line.taxBehavior !== 'none' ? ` · ${line.taxLabel} ${line.taxRate}% ${line.taxBehavior === 'included' ? 'incluido' : 'adicionado'}` : ''}</p>{line.taxBehavior !== 'none' && <p className="mt-1 text-[10px] text-slate-500">Neto {formatMoney(line.netAmount, calculation.currency)} · Impuesto {formatMoney(line.taxAmount, calculation.currency)}</p>}</div><strong className={line.amount < 0 ? 'text-emerald-600' : 'text-slate-700'}>{formatMoney(line.amount, calculation.currency)}</strong></div>
                          {line.adjustmentReason && <p className="mt-2 border-t border-violet-100 pt-2 text-xs text-slate-500">{line.adjustmentReason}{line.createdByName ? ` · ${line.createdByName}` : ''}</p>}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 sm:grid-cols-5"><span>Cargos<strong className="block text-sm text-slate-700">{formatMoney(calculation.chargeTotal, calculation.currency)}</strong></span><span>Descuentos<strong className="block text-sm text-emerald-600">{formatMoney(calculation.discountTotal, calculation.currency)}</strong></span><span>Impuestos<strong className="block text-sm text-violet-600">{formatMoney(calculation.taxTotal, calculation.currency)}</strong></span><span>Costos<strong className="block text-sm text-amber-600">{formatMoney(calculation.internalCostTotal, calculation.currency)}</strong></span><span>Comisiones<strong className="block text-sm text-violet-600">{formatMoney(calculation.commissionTotal, calculation.currency)}</strong></span></div>
                    {calculation.calculatedByName && <p className="mt-3 text-right text-[10px] text-slate-400">Generado por {calculation.calculatedByName}</p>}
                  </div>
                </details>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

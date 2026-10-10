import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Download,
  Filter,
  MapPin,
  Package,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Scale,
  TrendingUp,
  TriangleAlert,
  Truck,
  Users,
} from 'lucide-react';
import { getErrorMessage } from '../services/auth';
import {
  getFinancialStatistics,
  getFinancialStatisticsExport,
  getOperationalStatistics,
  getOperationalStatisticsExport,
  getPricingProfitabilityInsights,
  getStatisticsFilterOptions,
} from '../services/statistics';
import type {
  AppCurrency,
  FinancialStatistics,
  FinancialStatisticsRankingItem,
  OperationalStatistics,
  PricingProfitabilityInsights,
  ShipmentStatus,
  StatisticsFilterOptions,
  StatisticsFilters,
  StatisticsRankingItem,
} from '../types';

const EMPTY_OPTIONS: StatisticsFilterOptions = { clients: [], zones: [], cities: [] };
const STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: 'Pendientes',
  in_transit: 'En tránsito',
  delivered: 'Entregados',
  incident: 'Incidencias',
};
const STATUS_COLORS: Record<ShipmentStatus, string> = {
  pending: '#f59e0b',
  in_transit: '#3b82f6',
  delivered: '#10b981',
  incident: '#ef4444',
};
const CSV_STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: 'Pendiente',
  in_transit: 'En tránsito',
  delivered: 'Entregado',
  incident: 'Incidencia',
};

const escapeCsvValue = (value: string | number | null): string => {
  const normalized = value === null ? '' : String(value);
  const protectedValue = typeof value === 'string' && /^[=+\-@\t\r]/.test(normalized)
    ? `'${normalized}`
    : normalized;
  return `"${protectedValue.replaceAll('"', '""')}"`;
};

const toInputDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDefaultFilters = (): StatisticsFilters => {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateFrom.getDate() - 29);
  return {
    dateFrom: toInputDate(dateFrom),
    dateTo: toInputDate(dateTo),
    status: 'all',
    zoneId: '',
    clientId: '',
    destinationPlaceId: '',
  };
};

const formatNumber = (value: number): string => new Intl.NumberFormat('es-AR', {
  maximumFractionDigits: 1,
}).format(value);

const formatMoney = (value: number, currency: AppCurrency): string => new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency,
  maximumFractionDigits: 2,
}).format(value);

const formatShortDate = (value: string): string => {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' })
    .format(new Date(year, month - 1, day));
};

const percentageChange = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
};

interface KpiCardProps {
  title: string;
  value: string;
  icon: typeof Package;
  iconClasses: string;
  change?: number | null;
  changeSuffix?: string;
  inverseTrend?: boolean;
  onClick?: () => void;
}

const KpiCard = ({
  title,
  value,
  icon: Icon,
  iconClasses,
  change,
  changeSuffix = '%',
  inverseTrend = false,
  onClick,
}: KpiCardProps) => {
  const isPositive = change !== undefined && change !== null && change >= 0;
  const isFavorable = inverseTrend ? !isPositive : isPositive;
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper type={onClick ? 'button' : undefined} onClick={onClick} className={`rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all ${onClick ? 'hover:border-[var(--color-primary)]/30 hover:shadow-md' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconClasses}`}><Icon size={20} /></div>
      </div>
      {change !== undefined && (
        <div className={`mt-4 flex items-center text-xs font-medium ${change === null ? 'text-slate-400' : isFavorable ? 'text-emerald-600' : 'text-red-500'}`}>
          {change === null ? (
            <span>Sin base en el período anterior</span>
          ) : (
            <>
              {isPositive ? <ArrowUpRight size={15} className="mr-1" /> : <ArrowDownRight size={15} className="mr-1" />}
              {change > 0 ? '+' : ''}{formatNumber(change)}{changeSuffix}
              <span className="ml-1 font-normal text-slate-400">vs. período anterior</span>
            </>
          )}
        </div>
      )}
    </Wrapper>
  );
};

interface RankingCardProps {
  title: string;
  icon: typeof MapPin;
  items: StatisticsRankingItem[];
  total: number;
  emptyText: string;
  onSelect: (item: StatisticsRankingItem) => void;
}

const RankingCard = ({ title, icon: Icon, items, total, emptyText, onSelect }: RankingCardProps) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="flex items-center gap-2 font-bold text-slate-900"><Icon size={18} className="text-[var(--color-primary)]" /> {title}</h2>
    {items.length === 0 ? (
      <p className="py-10 text-center text-sm text-slate-400">{emptyText}</p>
    ) : (
      <div className="mt-5 space-y-4">
        {items.map((item, index) => (
          <button key={item.id} type="button" onClick={() => onSelect(item)} className="group block w-full text-left">
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-medium text-slate-700 group-hover:text-[var(--color-primary)]">{index + 1}. {item.label}</span>
              <span className="font-semibold text-slate-500">{item.count}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[var(--color-primary)]/70 transition-all group-hover:bg-[var(--color-primary)]" style={{ width: `${total ? Math.max(4, (item.count / total) * 100) : 0}%` }} />
            </div>
          </button>
        ))}
      </div>
    )}
  </section>
);

interface FinancialRankingCardProps {
  title: string;
  icon: typeof MapPin;
  currency: AppCurrency;
  items: FinancialStatisticsRankingItem[];
  emptyText: string;
  onSelect: (item: FinancialStatisticsRankingItem) => void;
}

const FinancialRankingCard = ({
  title,
  icon: Icon,
  currency,
  items,
  emptyText,
  onSelect,
}: FinancialRankingCardProps) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h3 className="flex items-center gap-2 font-bold text-slate-900">
      <Icon size={18} className="text-[var(--color-primary)]" /> {title}
    </h3>
    {items.length === 0 ? (
      <p className="py-10 text-center text-sm text-slate-400">{emptyText}</p>
    ) : (
      <div className="mt-4 divide-y divide-slate-100">
        {items.map((item, index) => (
          <button key={item.id} type="button" onClick={() => onSelect(item)} className="group flex w-full items-center justify-between gap-3 py-3 text-left">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-700 group-hover:text-[var(--color-primary)]">{index + 1}. {item.label}</p>
              <p className="mt-0.5 text-xs text-slate-400">{item.shipmentCount} movimientos · ingresos {formatMoney(item.revenue, currency)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-sm font-bold ${item.margin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatMoney(item.margin, currency)}</p>
              <p className="text-xs text-slate-400">{formatNumber(item.marginRate)}%</p>
            </div>
          </button>
        ))}
      </div>
    )}
  </section>
);

interface ProfitabilityInsightsPanelProps {
  data: PricingProfitabilityInsights | null;
  isLoading: boolean;
  error: string | null;
  currency: AppCurrency;
  filters: StatisticsFilters;
  onOpenMovements: (filters: StatisticsFilters) => void;
}

const ProfitabilityInsightsPanel = ({
  data,
  isLoading,
  error,
  currency,
  filters,
  onOpenMovements,
}: ProfitabilityInsightsPanelProps) => {
  const versions = data?.rateCardVersions.filter((item) => item.currency === currency) ?? [];
  const alerts = data?.marginAlerts.filter((item) => item.currency === currency) ?? [];

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" />;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-semibold">No pudimos cargar las comparativas avanzadas.</p>
        <p className="mt-1 text-xs text-amber-700">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <h3 className="flex items-center gap-2 font-bold text-slate-900"><BarChart3 size={18} className="text-[var(--color-primary)]" /> Rendimiento por versión tarifaria</h3>
          <p className="mt-1 text-xs text-slate-500">Compara únicamente snapshots vigentes expresados en {currency}.</p>
        </div>
        {versions.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No hay versiones utilizadas en este período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <tr><th className="px-5 py-3">Lista / versión</th><th className="px-3 py-3 text-right">Mov.</th><th className="px-3 py-3 text-right">Ingresos</th><th className="px-3 py-3 text-right">Ticket</th><th className="px-5 py-3 text-right">Margen</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {versions.map((version) => (
                  <tr key={version.rateCardVersionId}>
                    <td className="px-5 py-3"><p className="font-medium text-slate-800">{version.rateCardName}</p><p className="text-xs text-slate-400">Versión {version.versionNumber}</p></td>
                    <td className="px-3 py-3 text-right text-slate-600">{version.shipmentCount}</td>
                    <td className="px-3 py-3 text-right font-medium text-slate-700">{formatMoney(version.revenue, currency)}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{formatMoney(version.averageTicket, currency)}</td>
                    <td className={`px-5 py-3 text-right font-bold ${version.margin < 0 ? 'text-red-600' : 'text-emerald-600'}`}><p>{formatMoney(version.margin, currency)}</p><p className="text-xs font-medium">{formatNumber(version.marginRate)}%</p></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <h3 className="flex items-center gap-2 font-bold text-slate-900"><TriangleAlert size={18} className="text-amber-500" /> Alertas de margen</h3>
          <p className="mt-1 text-xs text-slate-500">Crítico si es negativo; bajo si es menor a {formatNumber(data.lowMarginThreshold)}%. Hay {data.alertCount} alertas en todas las monedas del período.</p>
        </div>
        {alerts.length === 0 ? (
          <div className="px-6 py-10 text-center"><CheckCircle2 size={30} className="mx-auto text-emerald-500" /><p className="mt-3 text-sm font-medium text-slate-700">Sin alertas para {currency}</p><p className="mt-1 text-xs text-slate-400">Los movimientos valorizados superan el umbral definido.</p></div>
        ) : (
          <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
            {alerts.map((alert) => (
              <button key={alert.shipmentId} type="button" onClick={() => onOpenMovements({ ...filters, dateFrom: alert.shipmentDate, dateTo: alert.shipmentDate, clientId: alert.clientId ?? filters.clientId })} className="group flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${alert.severity === 'negative' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{alert.severity === 'negative' ? 'Crítico' : 'Bajo'}</span><p className="truncate text-sm font-semibold text-slate-800 group-hover:text-[var(--color-primary)]">{alert.trackingNumber}</p></div>
                  <p className="mt-1 truncate text-xs text-slate-400">{alert.clientName} · {alert.rateCardName} v{alert.versionNumber} · {formatShortDate(alert.shipmentDate)}</p>
                </div>
                <div className="shrink-0 text-right"><p className={`text-sm font-bold ${alert.severity === 'negative' ? 'text-red-600' : 'text-amber-600'}`}>{formatMoney(alert.margin, currency)}</p><p className="text-xs text-slate-400">{formatNumber(alert.marginRate)}%</p></div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

interface FinancialAnalyticsProps {
  data: FinancialStatistics | null;
  insights: PricingProfitabilityInsights | null;
  isLoading: boolean;
  isInsightsLoading: boolean;
  error: string | null;
  insightsError: string | null;
  selectedCurrency: AppCurrency | null;
  onSelectCurrency: (currency: AppCurrency) => void;
  onRetry: () => void;
  onOpenMovements: (filters: StatisticsFilters) => void;
  filters: StatisticsFilters;
}

const FinancialAnalytics = ({
  data,
  insights,
  isLoading,
  isInsightsLoading,
  error,
  insightsError,
  selectedCurrency,
  onSelectCurrency,
  onRetry,
  onOpenMovements,
  filters,
}: FinancialAnalyticsProps) => {
  const activeSummary = data?.currencies.find((item) => item.currency === selectedCurrency)
    ?? data?.currencies[0];
  const activeCurrency = activeSummary?.currency;
  const filterRanking = (items: FinancialStatisticsRankingItem[]) => (
    activeCurrency ? items.filter((item) => item.currency === activeCurrency) : []
  );

  return (
    <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><CircleDollarSign size={21} className="text-[var(--color-primary)]" /> Analítica financiera estimada</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Usa el cálculo vigente e inmutable de cada movimiento. No representa facturación, saldos pendientes ni cobros.</p>
        </div>
        {data && data.currencies.length > 1 && (
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {data.currencies.map((item) => (
              <button key={item.currency} type="button" onClick={() => onSelectCurrency(item.currency)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeCurrency === item.currency ? 'bg-[var(--color-primary)] text-white' : 'text-slate-500 hover:bg-slate-100'}`}>{item.currency}</button>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-100 bg-white p-6 text-center shadow-sm">
          <AlertCircle size={28} className="mx-auto text-red-500" />
          <p className="mt-3 text-sm text-slate-600">{error}</p>
          <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white">Reintentar</button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard title="Cobertura valorizada" value={`${formatNumber(data.coverage.coverageRate)}%`} icon={Package} iconClasses="bg-violet-50 text-[var(--color-primary)]" onClick={() => onOpenMovements(filters)} />
            {activeSummary && (
              <>
                <KpiCard title="Ingresos estimados" value={formatMoney(activeSummary.estimatedRevenue, activeSummary.currency)} icon={CircleDollarSign} iconClasses="bg-emerald-50 text-emerald-600" change={percentageChange(activeSummary.estimatedRevenue, activeSummary.previousEstimatedRevenue)} />
                <KpiCard title="Costo + comisiones" value={formatMoney(activeSummary.estimatedCostTotal, activeSummary.currency)} icon={ReceiptText} iconClasses="bg-amber-50 text-amber-600" />
                <KpiCard title="Margen estimado" value={formatMoney(activeSummary.estimatedMargin, activeSummary.currency)} icon={Scale} iconClasses={activeSummary.estimatedMargin < 0 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'} change={percentageChange(activeSummary.estimatedMargin, activeSummary.previousEstimatedMargin)} />
                <KpiCard title="Ticket promedio" value={formatMoney(activeSummary.averageTicket, activeSummary.currency)} icon={TrendingUp} iconClasses="bg-cyan-50 text-cyan-600" />
              </>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs text-slate-400">Movimientos valorizados</p><p className="mt-1 font-semibold text-slate-800">{data.coverage.pricedShipments} de {data.coverage.totalShipments}</p></div>
              <div><p className="text-xs text-slate-400">Sin valorización</p><p className="mt-1 font-semibold text-slate-800">{data.coverage.unpricedShipments}</p></div>
              <div><p className="text-xs text-slate-400">Descuentos</p><p className="mt-1 font-semibold text-slate-800">{activeSummary ? formatMoney(activeSummary.discountTotal, activeSummary.currency) : '—'}</p></div>
              <div><p className="text-xs text-slate-400">Impuestos identificados</p><p className="mt-1 font-semibold text-slate-800">{activeSummary ? formatMoney(activeSummary.taxTotal, activeSummary.currency) : '—'}</p></div>
            </div>
          </div>

          {activeSummary ? (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <FinancialRankingCard title="Rentabilidad por cliente" icon={Users} currency={activeSummary.currency} items={filterRanking(data.topClients)} emptyText="No hay clientes valorizados." onSelect={(item) => onOpenMovements({ ...filters, clientId: item.id })} />
                <FinancialRankingCard title="Rentabilidad por zona" icon={MapPin} currency={activeSummary.currency} items={filterRanking(data.topZones)} emptyText="No hay zonas valorizadas." onSelect={(item) => onOpenMovements({ ...filters, zoneId: item.id })} />
                <FinancialRankingCard title="Rentabilidad por ciudad" icon={TrendingUp} currency={activeSummary.currency} items={filterRanking(data.topCities)} emptyText="No hay ciudades valorizadas." onSelect={(item) => onOpenMovements({ ...filters, destinationPlaceId: item.id })} />
              </div>
              <ProfitabilityInsightsPanel data={insights} isLoading={isInsightsLoading} error={insightsError} currency={activeSummary.currency} filters={filters} onOpenMovements={onOpenMovements} />
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <ReceiptText size={30} className="mx-auto text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No hay movimientos valorizados en este período.</p>
              <p className="mt-1 text-xs text-slate-400">Los movimientos sin lista tarifaria siguen incluidos en la cobertura.</p>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
};

interface StatisticsPageProps {
  canExport: boolean;
  canViewPricing: boolean;
  onOpenMovements: (filters: StatisticsFilters) => void;
}

export const StatisticsPage = ({ canExport, canViewPricing, onOpenMovements }: StatisticsPageProps) => {
  const [draftFilters, setDraftFilters] = useState<StatisticsFilters>(getDefaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<StatisticsFilters>(getDefaultFilters);
  const [options, setOptions] = useState<StatisticsFilterOptions>(EMPTY_OPTIONS);
  const [statistics, setStatistics] = useState<OperationalStatistics | null>(null);
  const [financialStatistics, setFinancialStatistics] = useState<FinancialStatistics | null>(null);
  const [profitabilityInsights, setProfitabilityInsights] = useState<PricingProfitabilityInsights | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<AppCurrency | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFinancialLoading, setIsFinancialLoading] = useState(canViewPricing);
  const [isInsightsLoading, setIsInsightsLoading] = useState(canViewPricing);
  const [error, setError] = useState<string | null>(null);
  const [financialError, setFinancialError] = useState<string | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isFinancialExporting, setIsFinancialExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const loadOptions = async () => {
      try {
        const loadedOptions = await getStatisticsFilterOptions();
        if (!isCancelled) setOptions(loadedOptions);
      } catch {
        // Statistics remain usable with date/status filters if options fail.
      }
    };
    void loadOptions();
    return () => { isCancelled = true; };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    const loadStatistics = async () => {
      try {
        const loadedStatistics = await getOperationalStatistics(appliedFilters);
        if (!isCancelled) {
          setStatistics(loadedStatistics);
          setError(null);
        }
      } catch (caughtError: unknown) {
        if (!isCancelled) setError(getErrorMessage(caughtError));
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };
    void loadStatistics();
    return () => { isCancelled = true; };
  }, [appliedFilters]);

  useEffect(() => {
    if (!canViewPricing) return;

    let isCancelled = false;
    const loadFinancialStatistics = async () => {
      setIsFinancialLoading(true);
      try {
        const loadedStatistics = await getFinancialStatistics(appliedFilters);
        if (!isCancelled) {
          setFinancialStatistics(loadedStatistics);
          setSelectedCurrency((current) => (
            loadedStatistics.currencies.some((item) => item.currency === current)
              ? current
              : (loadedStatistics.currencies[0]?.currency ?? null)
          ));
          setFinancialError(null);
        }
      } catch (caughtError: unknown) {
        if (!isCancelled) setFinancialError(getErrorMessage(caughtError));
      } finally {
        if (!isCancelled) setIsFinancialLoading(false);
      }
    };
    void loadFinancialStatistics();
    return () => { isCancelled = true; };
  }, [appliedFilters, canViewPricing]);

  useEffect(() => {
    if (!canViewPricing) return;

    let isCancelled = false;
    const loadInsights = async () => {
      setIsInsightsLoading(true);
      try {
        const loadedInsights = await getPricingProfitabilityInsights(appliedFilters);
        if (!isCancelled) {
          setProfitabilityInsights(loadedInsights);
          setInsightsError(null);
        }
      } catch (caughtError: unknown) {
        if (!isCancelled) setInsightsError(getErrorMessage(caughtError));
      } finally {
        if (!isCancelled) setIsInsightsLoading(false);
      }
    };
    void loadInsights();
    return () => { isCancelled = true; };
  }, [appliedFilters, canViewPricing]);

  const maxTrendValue = useMemo(() => Math.max(
    1,
    ...(statistics?.trend.map((point) => point.total) ?? [1]),
  ), [statistics]);

  const applyFilters = (nextFilters: StatisticsFilters) => {
    setDraftFilters(nextFilters);
    setIsLoading(true);
    if (canViewPricing) {
      setIsFinancialLoading(true);
      setIsInsightsLoading(true);
    }
    setAppliedFilters(nextFilters);
  };

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyFilters({ ...draftFilters });
  };

  const setQuickRange = (days: number) => {
    const dateTo = new Date();
    const dateFrom = new Date(dateTo);
    dateFrom.setDate(dateFrom.getDate() - (days - 1));
    setDraftFilters((current) => ({
      ...current,
      dateFrom: toInputDate(dateFrom),
      dateTo: toInputDate(dateTo),
    }));
  };

  const resetFilters = () => applyFilters(getDefaultFilters());

  const openMovementsByRanking = (
    key: 'zoneId' | 'clientId' | 'destinationPlaceId',
    item: StatisticsRankingItem,
  ) => onOpenMovements({ ...appliedFilters, [key]: item.id });

  const openMovementsByStatus = (status: ShipmentStatus | 'all') => (
    onOpenMovements({ ...appliedFilters, status })
  );

  const exportCsv = async () => {
    setIsExporting(true);
    setExportError(null);

    try {
      const rows = await getOperationalStatisticsExport(appliedFilters);
      if (rows.length === 0) {
        setExportError('No hay movimientos para exportar con los filtros seleccionados.');
        return;
      }

      const clientLabels = new Map(options.clients.map((option) => [option.id, option.label]));
      const zoneLabels = new Map(options.zones.map((option) => [option.id, option.label]));
      const csvRows = [
        ['Fecha', 'Seguimiento', 'Estado', 'Cliente', 'Zona', 'Ciudad destino', 'Dirección'],
        ...rows.map((row) => [
          row.shipment_date,
          row.tracking_number,
          CSV_STATUS_LABELS[row.status],
          row.client_id ? (clientLabels.get(row.client_id) ?? 'Cliente no disponible') : '',
          row.zone_id ? (zoneLabels.get(row.zone_id) ?? 'Zona no disponible') : '',
          row.destination_city ?? '',
          row.delivery_address,
        ]),
      ];
      const csv = `\uFEFF${csvRows
        .map((row) => row.map((value) => escapeCsvValue(value)).join(';'))
        .join('\r\n')}`;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `movimientos_${appliedFilters.dateFrom}_${appliedFilters.dateTo}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (caughtError: unknown) {
      setExportError(getErrorMessage(caughtError));
    } finally {
      setIsExporting(false);
    }
  };

  const exportFinancialCsv = async () => {
    setIsFinancialExporting(true);
    setExportError(null);

    try {
      const rows = await getFinancialStatisticsExport(appliedFilters);
      if (rows.length === 0) {
        setExportError('No hay movimientos valorizados para exportar con los filtros seleccionados.');
        return;
      }

      const csvRows: Array<Array<string | number | null>> = [
        [
          'ID movimiento', 'Fecha movimiento', 'Seguimiento', 'Estado', 'Cliente',
          'Zona', 'Ciudad destino', 'Lista tarifaria', 'Versión', 'Moneda',
          'Cargos', 'Descuentos', 'Ingreso estimado', 'Costo interno',
          'Comisiones', 'Costo estimado total', 'Margen estimado', 'Margen %',
          'Impuestos', 'Impuestos incluidos', 'Impuestos agregados', 'Calculado el',
        ],
        ...rows.map((row) => [
          row.shipment_id,
          row.shipment_date,
          row.tracking_number,
          CSV_STATUS_LABELS[row.status],
          row.client_name,
          row.zone_name,
          row.destination_city,
          row.rate_card_name,
          row.version_number,
          row.currency,
          row.charge_total,
          row.discount_total,
          row.estimated_revenue,
          row.internal_cost_total,
          row.commission_total,
          row.estimated_cost_total,
          row.estimated_margin,
          row.margin_rate,
          row.tax_total,
          row.included_tax_total,
          row.added_tax_total,
          row.calculated_at,
        ]),
      ];
      const csv = `\uFEFF${csvRows
        .map((row) => row.map((value) => escapeCsvValue(value)).join(';'))
        .join('\r\n')}`;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `finanzas_estimadas_${appliedFilters.dateFrom}_${appliedFilters.dateTo}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (caughtError: unknown) {
      setExportError(getErrorMessage(caughtError));
    } finally {
      setIsFinancialExporting(false);
    }
  };

  const summary = statistics?.summary;
  const periodDays = statistics?.trend.length ?? 1;

  return (
    <div className="animate-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Estadísticas operativas</h1>
        <p className="mt-1 text-slate-500">Analiza movimientos, entregas e incidencias con datos reales de tu empresa.</p>
      </div>

      <form onSubmit={submitFilters} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold text-slate-800"><Filter size={17} className="text-[var(--color-primary)]" /> Filtros</h2>
          <div className="flex flex-wrap gap-2">
            {[7, 30, 90].map((days) => <button key={days} type="button" onClick={() => setQuickRange(days)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50">{days} días</button>)}
            <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"><RotateCcw size={14} /> Restablecer</button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="text-xs font-medium text-slate-600">Desde<input required type="date" value={draftFilters.dateFrom} max={draftFilters.dateTo} onChange={(event) => setDraftFilters((current) => ({ ...current, dateFrom: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]" /></label>
          <label className="text-xs font-medium text-slate-600">Hasta<input required type="date" value={draftFilters.dateTo} min={draftFilters.dateFrom} onChange={(event) => setDraftFilters((current) => ({ ...current, dateTo: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]" /></label>
          <label className="text-xs font-medium text-slate-600">Estado<select value={draftFilters.status} onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value as ShipmentStatus | 'all' }))} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"><option value="all">Todos</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-600">Zona<select value={draftFilters.zoneId} onChange={(event) => setDraftFilters((current) => ({ ...current, zoneId: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"><option value="">Todas</option>{options.zones.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.type === 'group' ? 'Grupo' : 'Ciudad'}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-600">Ciudad destino<select value={draftFilters.destinationPlaceId} onChange={(event) => setDraftFilters((current) => ({ ...current, destinationPlaceId: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"><option value="">Todas</option>{options.cities.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-600">Cliente<select value={draftFilters.clientId} onChange={(event) => setDraftFilters((current) => ({ ...current, clientId: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"><option value="">Todos</option>{options.clients.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {canExport && canViewPricing && <button type="button" disabled={isFinancialLoading || isFinancialExporting || !financialStatistics?.coverage.pricedShipments} onClick={() => void exportFinancialCsv()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {isFinancialExporting ? <RefreshCw size={16} className="animate-spin" /> : <CircleDollarSign size={16} />} {isFinancialExporting ? 'Exportando finanzas...' : 'Exportar finanzas CSV'}
          </button>}
          {canExport && <button type="button" disabled={isLoading || isExporting || !statistics?.summary.total} onClick={() => void exportCsv()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {isExporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />} {isExporting ? 'Exportando...' : 'Exportar CSV'}
          </button>}
          <button disabled={isLoading} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-60">{isLoading ? <RefreshCw size={16} className="animate-spin" /> : <BarChart3 size={16} />} Aplicar filtros</button>
        </div>
        {exportError && <p className="mt-3 text-right text-sm text-red-600">{exportError}</p>}
      </form>

      {error ? (
        <div className="rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <AlertCircle size={36} className="mx-auto text-red-500" />
          <h2 className="mt-4 font-semibold text-slate-900">No pudimos calcular las estadísticas</h2>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
          <button type="button" onClick={() => applyFilters({ ...appliedFilters })} className="mt-5 rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white">Reintentar</button>
        </div>
      ) : isLoading || !summary ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-7">{[1, 2, 3, 4, 5, 6, 7].map((item) => <div key={item} className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <KpiCard title="Movimientos" value={formatNumber(summary.total)} icon={Package} iconClasses="bg-violet-50 text-[var(--color-primary)]" change={percentageChange(summary.total, summary.previousTotal)} onClick={() => onOpenMovements(appliedFilters)} />
            <KpiCard title="Tasa de entrega" value={`${formatNumber(summary.deliveryRate)}%`} icon={TrendingUp} iconClasses="bg-emerald-50 text-emerald-600" change={summary.deliveryRate - summary.previousDeliveryRate} changeSuffix=" pp" onClick={() => onOpenMovements(appliedFilters)} />
            <KpiCard title="Entregados" value={formatNumber(summary.delivered)} icon={CheckCircle2} iconClasses="bg-emerald-50 text-emerald-600" change={percentageChange(summary.delivered, summary.previousDelivered)} onClick={() => openMovementsByStatus('delivered')} />
            <KpiCard title="Pendientes" value={formatNumber(summary.pending)} icon={Clock3} iconClasses="bg-amber-50 text-amber-600" onClick={() => openMovementsByStatus('pending')} />
            <KpiCard title="En tránsito" value={formatNumber(summary.inTransit)} icon={Truck} iconClasses="bg-blue-50 text-blue-600" onClick={() => openMovementsByStatus('in_transit')} />
            <KpiCard title="Incidencias" value={formatNumber(summary.incidents)} icon={TriangleAlert} iconClasses="bg-red-50 text-red-600" change={percentageChange(summary.incidents, summary.previousIncidents)} inverseTrend onClick={() => openMovementsByStatus('incident')} />
            <KpiCard title="Promedio diario" value={formatNumber(summary.averageDailyVolume)} icon={BarChart3} iconClasses="bg-blue-50 text-blue-600" change={percentageChange(summary.averageDailyVolume, summary.previousTotal / periodDays)} onClick={() => onOpenMovements(appliedFilters)} />
          </div>

          {canViewPricing && (
            <FinancialAnalytics
              data={financialStatistics}
              insights={profitabilityInsights}
              isLoading={isFinancialLoading}
              isInsightsLoading={isInsightsLoading}
              error={financialError}
              insightsError={insightsError}
              selectedCurrency={selectedCurrency}
              onSelectCurrency={setSelectedCurrency}
              onRetry={() => applyFilters({ ...appliedFilters })}
              onOpenMovements={onOpenMovements}
              filters={appliedFilters}
            />
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="font-bold text-slate-900">Tendencia diaria</h2><p className="mt-1 text-xs text-slate-500">Volumen total, entregas e incidencias por fecha.</p></div>
                <div className="flex gap-3 text-xs text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-primary)]" /> Total</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Entregados</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Incidencias</span></div>
              </div>
              <div className="mt-6 overflow-x-auto pb-2">
                <div className="flex h-56 min-w-[720px] items-end gap-1 border-b border-slate-200 px-1">
                  {statistics.trend.map((point, index) => {
                    const totalHeight = point.total ? Math.max(4, (point.total / maxTrendValue) * 180) : 2;
                    const deliveredHeight = point.delivered ? Math.max(3, (point.delivered / maxTrendValue) * 180) : 0;
                    const labelEvery = Math.max(1, Math.ceil(statistics.trend.length / 8));
                    return (
                      <button type="button" key={point.date} onClick={() => onOpenMovements({ ...appliedFilters, dateFrom: point.date, dateTo: point.date })} title={`${formatShortDate(point.date)}: ${point.total} movimientos, ${point.delivered} entregados, ${point.incidents} incidencias`} className="group relative flex h-full min-w-2 flex-1 items-end justify-center">
                        <div className="relative w-full max-w-7 rounded-t bg-[var(--color-primary)]/75 transition-colors group-hover:bg-[var(--color-primary)]" style={{ height: totalHeight }}>
                          <div className="absolute inset-x-0 bottom-0 rounded-t bg-emerald-400/90" style={{ height: deliveredHeight }} />
                          {point.incidents > 0 && <span className="absolute -top-1.5 right-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-surface)] bg-red-500" />}
                        </div>
                        {index % labelEvery === 0 && <span className="absolute -bottom-6 text-[10px] text-slate-400">{formatShortDate(point.date)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-900">Distribución por estado</h2>
              <p className="mt-1 text-xs text-slate-500">Selecciona un estado para ver sus movimientos.</p>
              <div className="mt-6 space-y-5">
                {statistics.statusDistribution.map((point) => {
                  const percentage = summary.total ? (point.count / summary.total) * 100 : 0;
                  return (
                    <button key={point.status} type="button" onClick={() => openMovementsByStatus(point.status)} className="block w-full text-left">
                      <span className="mb-2 flex items-center justify-between text-sm"><span className="font-medium text-slate-600">{STATUS_LABELS[point.status]}</span><span className="font-semibold text-slate-800">{point.count} · {formatNumber(percentage)}%</span></span>
                      <span className="block h-2.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${percentage}%`, backgroundColor: STATUS_COLORS[point.status] }} /></span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <RankingCard title="Zonas con más movimiento" icon={MapPin} items={statistics.topZones} total={summary.total} emptyText="No hay zonas en este período." onSelect={(item) => openMovementsByRanking('zoneId', item)} />
            <RankingCard title="Ciudades principales" icon={TrendingUp} items={statistics.topCities} total={summary.total} emptyText="No hay ciudades en este período." onSelect={(item) => openMovementsByRanking('destinationPlaceId', item)} />
            <RankingCard title="Clientes principales" icon={Users} items={statistics.topClients} total={summary.total} emptyText="No hay clientes en este período." onSelect={(item) => openMovementsByRanking('clientId', item)} />
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Tipos do lado do cliente para as respostas da API. Valores monetários e
 * percentuais chegam como **string** (mesma convenção do backend — nunca
 * `number`, para não fingir precisão que o float não tem). Formatação para
 * exibição fica em `src/lib/format.ts`.
 */

export type JobStatus = "pending" | "processing" | "completed" | "error" | "cancelled";
export type Direction = "CALL" | "PUT" | "DOJI";
export type DojiPolicy = "ignore" | "count_as_loss" | "count_as_tie";
export type EntryStrategy = "same_direction" | "contrarian";
export type PatternStatus =
  | "forte_e_ativo"
  | "ativo"
  | "perdendo_forca"
  | "inativo"
  | "amostra_insuficiente";

export interface CurrencyPairTimeframeCoverage {
  timeframe: string;
  candleCount: number;
  firstCandle: string;
  lastCandle: string;
}

export interface CurrencyPair {
  id: string;
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  createdAt: string;
  candleCount: number;
  timeframes: CurrencyPairTimeframeCoverage[];
}

export interface Candle {
  openTime: string;
  closeTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
}

export interface CandlesQuery {
  currencyPairId: string;
  timeframe: string;
  from?: string;
  to?: string;
  timeOfDay?: string;
  timezone?: string;
  limit?: number;
}

export interface CandlesResult {
  items: Candle[];
  symbol: string;
  total: number;
  truncated: boolean;
  limit: number;
}

export interface DataProvider {
  id: string;
  userId: string;
  name: string;
  type: "csv" | "api";
  config: Record<string, unknown>;
  createdAt: string;
}

export interface ImportJob {
  id: string;
  userId: string;
  dataProviderId: string;
  fileName: string | null;
  status: JobStatus;
  progressPct: number;
  totalRows: number | null;
  importedRows: number | null;
  duplicateRows: number | null;
  errorRows: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportResult {
  importJobId: string;
  dataProviderId: string;
  status: "completed";
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  symbols: string[];
  timeframes: string[];
}

export interface YahooImportWindow {
  symbol: string;
  requestedFrom: string;
  effectiveFrom: string;
  to: string;
  truncated: boolean;
  maxLookbackDays: number | null;
  barsLoaded: number;
}

export interface YahooImportResult extends ImportResult {
  windows: YahooImportWindow[];
  warning: string | null;
}

export interface Analysis {
  id: string;
  userId: string;
  name: string;
  status: JobStatus;
  progressPct: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AnalysisConfiguration {
  id: string;
  analysisId: string;
  currencyPairIds: string[];
  timeframe: string;
  historicalDays: number | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  minRepetitionPct: string;
  minValidDays: number;
  /** null = sem limite (todos os horários que passarem do % mínimo). */
  topN: number | null;
  weekdays: number[] | null;
  dataProviderId: string | null;
  dojiTolerancePct: string;
  dojiPolicy: DojiPolicy;
}

export interface AnalysisDetail {
  analysis: Analysis;
  configuration: AnalysisConfiguration | null;
  patternResultCount: number;
}

export interface CreateAnalysisInput {
  name: string;
  currencyPairIds: string[];
  timeframe: string;
  historicalDays?: number;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  timezone: string;
  minRepetitionPct: string;
  minValidDays: number;
  /** Omitido = sem limite (todos os horários que passarem do % mínimo). */
  topN?: number;
  weekdays?: number[];
  dojiTolerancePct: string;
  dojiPolicy: DojiPolicy;
}

export interface CreateAnalysisResult {
  analysis: Analysis;
  processed: boolean;
  candlesLoaded?: number;
  patternsFound?: number;
}

export interface PatternResult {
  id: string;
  analysisId: string;
  currencyPairId: string;
  timeframe: string;
  timeOfDay: string;
  timezone: string;
  totalDaysAnalyzed: number;
  totalValid: number;
  callCount: number;
  putCount: number;
  dojiCount: number;
  predominantDirection: Direction | null;
  repetitionPct: string;
  recent5Pct: string | null;
  recent10Pct: string | null;
  recent20PctPeriodPct: string | null;
  currentStreak: number;
  lastOccurrenceDate: string | null;
  daysSinceLastOccurrence: number | null;
  status: PatternStatus;
  confidenceNote: string;
  occurrences: Array<{ day: string; direction: Direction }>;
  createdAt: string;
  symbol: string;
  analysisName: string;
}

export type DayPeriod = "madrugada" | "manha" | "tarde" | "noite";

export interface PatternResultsQuery {
  analysisId?: string;
  currencyPairId?: string;
  timeframe?: string;
  timeOfDay?: string;
  period?: DayPeriod;
  status?: PatternStatus;
  direction?: "CALL" | "PUT";
  minPct?: string;
  onlyActive?: boolean;
  sortBy?: "repetitionPct" | "totalValid" | "recent10Pct" | "timeOfDay" | "direction";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface GroupStats {
  operations: number;
  wins: number;
  losses: number;
  ties: number;
  netProfitLoss: string;
}

export interface DailyResult {
  date: string;
  entries: number;
  finalLevel: number;
  symbol: string;
  timeOfDay: string;
  result: "win" | "loss" | "tie";
  profitLoss: string;
}

export interface BacktestSummary {
  finalBankroll: string;
  /** Total de ENTRADAS individuais — ver `totalDays` para a contagem por dia. */
  totalOperations: number;
  /** Dias vencidos/perdidos/empatados (não entradas) — o objetivo é 1 vitória por dia. */
  wins: number;
  losses: number;
  ties: number;
  maxDrawdown: string;
  /** Calculado sobre o resultado líquido de cada dia, não sobre entradas isoladas. */
  profitFactor: string | null;
  bySymbol: Record<string, GroupStats>;
  byTimeOfDay: Record<string, GroupStats>;
  byWeekday: Record<string, GroupStats>;
  byMonth: Record<string, GroupStats>;
  /** Granularidade por ENTRADA — ex: byMartingaleLevel["0"].wins = vitórias no nível 0. */
  byMartingaleLevel: Record<string, GroupStats>;
  totalDays: number;
  dailyWinPct: string;
  dailyLossPct: string;
  fullMartingaleLosses: number;
  maxWinStreakDays: number;
  maxLossStreakDays: number;
  returnPct: string;
  dailyResults: DailyResult[];
}

export interface Backtest {
  id: string;
  userId: string;
  /** Opcional — não é pedido na criação, pode ser definido/editado depois pela tela. */
  name: string | null;
  patternResultIds: string[];
  entryStrategy: EntryStrategy;
  payoutPct: string;
  initialBankroll: string;
  /** Entrada e lucro mínimo são derivados automaticamente a partir deste percentual (calculateAutoRecovery). */
  maxExposurePct: string;
  /** Derivado: patternResultIds.length - 1 (não é mais informado pelo usuário). */
  martingaleLevels: number;
  dailyLossLimit: string | null;
  maxOperationsPerDay: number | null;
  dojiPolicy: DojiPolicy;
  oneEntryPerTimeSlot: boolean;
  periodStart: string;
  periodEnd: string;
  status: JobStatus;
  progressPct: number;
  errorMessage: string | null;
  finalBankroll: string | null;
  totalOperations: number | null;
  maxDrawdown: string | null;
  profitFactor: string | null;
  summary: BacktestSummary | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateBacktestInput {
  name?: string;
  /** Todos precisam vir da mesma análise; a quantidade define os níveis de Martingale. */
  patternResultIds: string[];
  entryStrategy: EntryStrategy;
  payoutPct: string;
  initialBankroll: string;
  maxExposurePct: string;
  dojiPolicy: DojiPolicy;
  periodStart: string;
  periodEnd: string;
}

export interface CreateBacktestResult {
  backtest: Backtest;
  processed: boolean;
  candlesLoaded?: number;
  totalOperations?: number;
  finalBankroll?: string;
}

export interface BacktestOperation {
  id: string;
  backtestId: string;
  operationDate: string;
  currencyPairId: string;
  timeOfDay: string;
  entryDirection: Direction;
  actualDirection: Direction;
  martingaleLevelReached: number;
  entryValue: string;
  result: "win" | "loss" | "tie";
  profitLoss: string;
  bankrollAfter: string;
  dailyCumulativeProfitLoss: string;
  createdAt: string;
  symbol: string;
}

/**
 * Gerenciamento de banca MANUAL (planilha) — diferente do Backtest, o
 * resultado de cada linha é marcado pelo usuário, não calculado a partir de
 * candle histórico. Vinculado a UMA análise, mas essa vinculação pode ser
 * trocada depois (ver `UpdateBankrollLedgerInput.analysisId`) sem afetar as
 * linhas já lançadas.
 */
export interface BankrollLedger {
  id: string;
  userId: string;
  analysisId: string;
  name: string | null;
  initialBankroll: string;
  createdAt: string;
}

export interface BankrollLedgerSummary extends BankrollLedger {
  analysisName: string;
  totalOperations: number;
  currentBalance: string;
}

export interface BankrollLedgerSlot {
  id: string; // patternResultId
  symbol: string;
  timeOfDay: string;
  predominantDirection: Direction | null;
}

export interface BankrollLedgerEntry {
  id: string;
  ledgerId: string;
  patternResultId: string;
  symbol: string;
  timeOfDay: string;
  predominantDirection: Direction | null;
  date: string;
  payoutPct: string;
  entryValue: string;
  result: "win" | "loss" | "tie";
  profitLoss: string;
  bankrollAfter: string;
  createdAt: string;
}

export interface BankrollLedgerDetail {
  ledger: BankrollLedger;
  analysisName: string | null;
  availableSlots: BankrollLedgerSlot[];
  entries: BankrollLedgerEntry[];
  totals: {
    totalOperations: number;
    wins: number;
    losses: number;
    ties: number;
    currentBalance: string;
  };
}

export interface CreateBankrollLedgerInput {
  analysisId: string;
  name?: string;
  initialBankroll: string;
}

export interface UpdateBankrollLedgerInput {
  name?: string;
  initialBankroll?: string;
  analysisId?: string;
}

export interface CreateBankrollLedgerEntryInput {
  patternResultId: string;
  date: string;
  payoutPct: string;
  entryValue: string;
  result: "win" | "loss" | "tie";
}

export type UpdateBankrollLedgerEntryInput = Partial<CreateBankrollLedgerEntryInput>;

export interface MartingaleLevelResult {
  levelIndex: number;
  levelName: string;
  entryValue: string;
  accumulatedLossesBefore: string;
  grossProfitIfWin: string;
  netProfitAfterRecovery: string;
  accumulatedExposure: string;
  pctOfBankrollUsed: string;
  remainingBalanceIfLost: string;
  bankrollSupportsNextLevel: boolean;
}

export interface MartingaleResult {
  levels: MartingaleLevelResult[];
  totalCapitalRequired: string;
  maxExposure: string;
  pctBankrollExposed: string;
  lossIfAllLevelsFail: string;
  bankrollAfterFullLoss: string;
  recommendedMinimumBankroll: string;
  maxLevelsSupportedByBankroll: number;
}

export interface MartingaleCalculationInput {
  bankroll: string;
  payoutPct: string;
  martingaleLevels: number;
  maxExposurePct: string;
}

export interface BankrollConfiguration {
  id: string;
  userId: string;
  name: string;
  bankroll: string;
  payoutPct: string;
  maxExposurePct: string | null;
  createdAt: string;
}

export interface CreateBankrollConfigurationInput {
  name: string;
  bankroll: string;
  payoutPct: string;
  maxExposurePct?: string;
}

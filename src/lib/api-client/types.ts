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

export interface CurrencyPair {
  id: string;
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  createdAt: string;
  candleCount: number;
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
  topN: number;
  weekdays: number[] | null;
  dataProviderId: string | null;
  entryStrategy: EntryStrategy;
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
  topN: number;
  weekdays?: number[];
  entryStrategy: EntryStrategy;
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

export interface PatternResultsQuery {
  analysisId?: string;
  currencyPairId?: string;
  timeframe?: string;
  timeOfDay?: string;
  status?: PatternStatus;
  direction?: "CALL" | "PUT";
  minPct?: string;
  onlyActive?: boolean;
  sortBy?: "repetitionPct" | "totalValid" | "recent10Pct" | "timeOfDay";
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

export interface BacktestSummary {
  finalBankroll: string;
  totalOperations: number;
  wins: number;
  losses: number;
  ties: number;
  maxDrawdown: string;
  profitFactor: string | null;
  byCurrencyPair: Record<string, GroupStats>;
  byTimeOfDay: Record<string, GroupStats>;
  byWeekday: Record<string, GroupStats>;
  byMonth: Record<string, GroupStats>;
}

export interface Backtest {
  id: string;
  userId: string;
  patternResultIds: string[];
  entryStrategy: EntryStrategy;
  payoutPct: string;
  initialBankroll: string;
  initialEntry: string;
  minProfit: string;
  martingaleLevels: number;
  maxExposureLimit: string | null;
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
  patternResultIds: string[];
  entryStrategy: EntryStrategy;
  payoutPct: string;
  initialBankroll: string;
  initialEntry: string;
  minProfit: string;
  martingaleLevels: number;
  maxExposureLimit?: string;
  dailyLossLimit?: string;
  maxOperationsPerDay?: number;
  dojiPolicy: DojiPolicy;
  oneEntryPerTimeSlot: boolean;
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
  createdAt: string;
  symbol: string;
}

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

export interface MartingaleMode1Input {
  mode: "initial_entry";
  bankroll: string;
  payoutPct: string;
  initialEntry: string;
  minProfit: string;
  martingaleLevels: number;
  maxExposurePct?: string;
}

export interface MartingaleMode2Input {
  mode: "auto_split";
  bankroll: string;
  payoutPct: string;
  minProfit: string;
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

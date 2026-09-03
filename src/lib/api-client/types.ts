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

// ---------------------------------------------------------------------------
// MultiPeriodAnalysis ("Análise Plus") — paralela à Analysis/PatternResult
// acima. Um padrão é a chave PAR+HORÁRIO+DIREÇÃO avaliado em várias janelas
// (50D, 60D, ... até `maxDays`, + uma janela de momentum fixa em 40D), com um
// Confidence Score 0-100 combinando persistência, frequência, estabilidade,
// amostra e momentum. Ver `src/lib/core/multi-period-scoring.ts`.
// ---------------------------------------------------------------------------

export type MultiPeriodClassification = "excelente" | "forte" | "bom" | "observar" | "descartar";
export type MultiPeriodRecommendation = "a_favor" | "contra" | "observar" | "descartar";
export type MultiPeriodMomentumTrend = "fortalecendo" | "estavel" | "enfraquecendo" | "possivel_inversao";
export type MultiPeriodInversionState = "none" | "possible" | "confirmed";

export interface MultiPeriodAnalysis {
  id: string;
  userId: string;
  name: string;
  status: JobStatus;
  progressPct: number;
  errorMessage: string | null;
  referenceDate: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface MultiPeriodAnalysisConfiguration {
  id: string;
  analysisId: string;
  currencyPairIds: string[];
  timeframe: string;
  /** Período máximo EFETIVO — múltiplo de 10, mínimo 50. As janelas estruturais e a de momentum (40D) são derivadas automaticamente. */
  maxDays: number;
  /** Preenchidos só no modo "período específico" (em vez de "últimos N dias"). */
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  weekdays: number[] | null;
  dataProviderId: string | null;
  dojiTolerancePct: string;
  dojiPolicy: DojiPolicy;
  persistenceThresholdPct: string;
}

export interface MultiPeriodAnalysisDetail {
  analysis: MultiPeriodAnalysis;
  configuration: MultiPeriodAnalysisConfiguration | null;
  patternResultCount: number;
}

export interface CreateMultiPeriodAnalysisInput {
  name: string;
  currencyPairIds: string[];
  timeframe: string;
  /** Modo "últimos N dias". Informe isto OU startDate+endDate. */
  maxDays?: number;
  /** Modo "período específico". */
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  timezone: string;
  weekdays?: number[];
  dataProviderId?: string;
  dojiTolerancePct?: string;
  dojiPolicy?: DojiPolicy;
  persistenceThresholdPct?: string;
}

export interface CreateMultiPeriodAnalysisResult {
  analysis: MultiPeriodAnalysis;
  processed: boolean;
  candlesLoaded?: number;
  patternsFound?: number;
  error?: string;
}

export interface MultiPeriodWindow {
  id: string;
  patternResultId: string;
  days: number;
  isMomentum: boolean;
  /** % de ocorrências, dentro da janela, na direção do padrão. */
  frequency: string;
  validSamples: number;
  callCount: number;
  putCount: number;
  dojiCount: number;
}

export interface MultiPeriodPatternResult {
  id: string;
  analysisId: string;
  currencyPairId: string;
  timeframe: string;
  timeOfDay: string;
  timezone: string;
  direction: "CALL" | "PUT";
  structuralAverage: string;
  confidenceScore: number;
  classification: MultiPeriodClassification;
  recommendation: MultiPeriodRecommendation;
  momentumTrend: MultiPeriodMomentumTrend;
  inversionState: MultiPeriodInversionState;
  persistenceConfirmed: number;
  persistenceTotal: number;
  persistencePercentage: string;
  stabilityRange: string;
  stabilityStdDev: string;
  /** Ocorrências válidas na maior janela estrutural — "dias válidos" pra exibição. */
  totalValid: number;
  /** Menor amostra válida entre as janelas estruturais — usado só na fórmula do score de amostra, não representa o total. */
  sampleMin: number;
  scorePersistence: string;
  scoreFrequency: string;
  scoreStability: string;
  scoreSample: string;
  scoreMomentum: string;
  recentMomentumFrequency: string;
  recentMomentumOppositeFrequency: string;
  recentMomentumValidSamples: number;
  createdAt: string;
  symbol: string;
}

/** Linha da tabela principal (`GET /api/multi-period-pattern-results`) — inclui o nome da análise de origem. */
export interface MultiPeriodPatternResultSummary extends MultiPeriodPatternResult {
  analysisName: string;
}

/** Detalhe com as janelas — usado na linha expandida e no Top 5. */
export interface MultiPeriodPatternResultDetail extends MultiPeriodPatternResult {
  windows: MultiPeriodWindow[];
  momentumWindow: MultiPeriodWindow | null;
}

export interface MultiPeriodPatternResultsQuery {
  analysisId?: string;
  currencyPairId?: string;
  direction?: "CALL" | "PUT";
  classification?: MultiPeriodClassification;
  recommendation?: MultiPeriodRecommendation;
  sortBy?: "confidenceScore" | "structuralAverage" | "timeOfDay" | "persistencePercentage";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
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
 * candle histórico. Vinculado a UMA análise — de período único
 * (`analysisId`) OU Plus (`multiPeriodAnalysisId`), exatamente uma das duas
 * — mas essa vinculação pode ser trocada depois (inclusive de um tipo pro
 * outro, ver `UpdateBankrollLedgerInput`) sem afetar as linhas já lançadas.
 */
export interface BankrollLedger {
  id: string;
  userId: string;
  /** Derivado: "plus" quando `multiPeriodAnalysisId` está preenchido, "single" caso contrário. */
  analysisType: "single" | "plus";
  analysisId: string | null;
  multiPeriodAnalysisId: string | null;
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
  /** patternResultId (type="single") ou multiPeriodPatternResultId (type="plus"). */
  id: string;
  type: "single" | "plus";
  symbol: string;
  timeOfDay: string;
  predominantDirection: Direction | null;
  /** Só preenchido pra slots "plus" — usado pra mostrar/ordenar o TOP 20. */
  confidenceScore: number | null;
}

export interface BankrollLedgerEntry {
  id: string;
  ledgerId: string;
  /** Exatamente um dos dois é preenchido, conforme o tipo da análise vinculada quando a linha foi criada. */
  patternResultId: string | null;
  multiPeriodPatternResultId: string | null;
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
  /** TODOS os horários da análise (período único) ou só o TOP 20 por Confidence Score (Análise Plus). */
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
  /** Exatamente um entre analysisId e multiPeriodAnalysisId. */
  analysisId?: string;
  multiPeriodAnalysisId?: string;
  name?: string;
  initialBankroll: string;
}

export interface UpdateBankrollLedgerInput {
  name?: string;
  initialBankroll?: string;
  /** No máximo um entre os dois — informar um deles troca o tipo da análise vinculada e limpa o outro. */
  analysisId?: string;
  multiPeriodAnalysisId?: string;
}

export interface CreateBankrollLedgerEntryInput {
  /** Exatamente um entre os dois, conforme o tipo da análise vinculada ao ledger no momento. */
  patternResultId?: string;
  multiPeriodPatternResultId?: string;
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

// ---------------------------------------------------------------------------
// BacktestPlus — avalia 5 modelos de seleção sobre o resultado JÁ CONGELADO
// (snapshot) de uma Análise Plus concluída, contra candles FUTURAS reais.
// Objetivo primário: minimizar dias 0/N (todas as N entradas do dia
// perdedoras), não maximizar vitórias totais. Ver `src/lib/backtest-plus/`.
// ---------------------------------------------------------------------------

export type BacktestPlusModelType = "top_score" | "random" | "rotation" | "weighted_score" | "diversified";
export type BacktestPlusEntryResult = "win" | "loss" | "tie" | "invalid";
export type BacktestPlusInvalidReason = "no_data" | "doji";

export const BACKTEST_PLUS_MODEL_LABELS: Record<BacktestPlusModelType, string> = {
  top_score: "Top Score",
  random: "Aleatório",
  rotation: "Rotação",
  weighted_score: "Ponderado",
  diversified: "Diversificado",
};

export interface BacktestPlus {
  id: string;
  userId: string;
  sourceAnalysisId: string;
  name: string | null;
  /** Data-base congelada da Análise Plus origem no momento da criação — todo o pool reflete o estado da análise EXATAMENTE nesta data. */
  referenceDate: string;
  entriesPerDay: number; // 4 ou 5
  forwardDaysRequested: number; // 1-5
  randomSeed: number;
  status: JobStatus;
  progressPct: number;
  errorMessage: string | null;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  /** Dias operacionais efetivamente encontrados/testados — pode ser < forwardDaysRequested se faltar candle na ponta, nunca mais. */
  daysTested: number | null;
  bestModel: BacktestPlusModelType | null;
  createdAt: string;
  completedAt: string | null;
}

export interface BacktestPlusSummary extends BacktestPlus {
  sourceAnalysisName: string;
}

export interface BacktestPlusCandidate {
  id: string;
  backtestId: string;
  sourceResultId: string;
  poolRank: number; // 0-9
  currencyPairId: string;
  symbol: string;
  timeOfDay: string;
  timeframe: string;
  direction: "CALL" | "PUT";
  confidenceScore: number;
  classification: MultiPeriodClassification;
  recommendation: MultiPeriodRecommendation;
  momentumTrend: MultiPeriodMomentumTrend;
  structuralAverage: string;
}

export interface BacktestPlusEntry {
  id: string;
  modelId: string;
  candidateId: string;
  targetDate: string;
  entryOrder: number;
  result: BacktestPlusEntryResult;
  invalidReason: BacktestPlusInvalidReason | null;
  candleOpenTime: string | null;
  candleOpen: string | null;
  candleHigh: string | null;
  candleLow: string | null;
  candleClose: string | null;
  actualDirection: Direction | null;
  candidate: BacktestPlusCandidate | null;
}

export interface BacktestPlusModel {
  id: string;
  backtestId: string;
  modelType: BacktestPlusModelType;
  /** 1 = melhor modelo (menor zeroOfNRate > maior dailySuccessRate > maior individualHitRate > menor averageEntriesUntilFirstWin > maior totalWins). */
  rankPosition: number;
  daysTested: number;
  successfulDays: number;
  failedDays: number;
  dailySuccessRate: string;
  zeroOfNRate: string;
  totalEntries: number;
  totalWins: number;
  totalLosses: number;
  totalTies: number;
  invalidEntries: number;
  individualHitRate: string;
  averageEntriesUntilFirstWin: string | null;
  medianEntriesUntilFirstWin: string | null;
  firstWinAt1: number;
  firstWinAt2: number;
  firstWinAt3: number;
  firstWinAt4: number;
  firstWinAt5: number | null; // null quando entriesPerDay=4
  zeroOfN: number;
  coverageAt1: string;
  coverageAt2: string;
  coverageAt3: string;
  coverageAt4: string;
  coverageAt5: string | null; // null quando entriesPerDay=4
  entries: BacktestPlusEntry[];
}

export interface BacktestPlusDetail {
  backtestPlus: BacktestPlus;
  candidates: BacktestPlusCandidate[];
  /** Já vem ordenado por rankPosition (melhor primeiro). */
  models: BacktestPlusModel[];
}

export interface CreateBacktestPlusInput {
  name?: string;
  sourceAnalysisId: string;
  /** Exatamente 10, distintos — a ordem vira poolRank (desempate determinístico). */
  candidateIds: string[];
  entriesPerDay: 4 | 5;
  forwardDaysRequested: number; // 1-5
}

export interface CreateBacktestPlusResult {
  backtestPlus: BacktestPlus;
  processed: boolean;
  candlesLoaded?: number;
  daysTested?: number;
  bestModel?: string;
  error?: string;
}

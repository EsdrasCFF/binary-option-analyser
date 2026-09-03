/**
 * Schema Drizzle ORM, dialeto Postgres, pensado para rodar em Neon
 * (serverless Postgres). Cobre as entidades do domínio descritas no
 * briefing original: User, DataProvider, CurrencyPair, Candle, Analysis,
 * AnalysisConfiguration, PatternResult, MultiPeriodAnalysis (a "Análise
 * Plus"), MultiPeriodAnalysisConfiguration, MultiPeriodPatternResult,
 * MultiPeriodWindow, Backtest, BacktestOperation, BankrollLedger,
 * BankrollLedgerEntry, BankrollConfiguration, MartingaleCalculation,
 * MartingaleLevel, ImportJob, AuditLog.
 *
 * Convenções:
 * - Todos os timestamps em UTC (timestamptz do Postgres).
 * - Valores monetários e percentuais como numeric (não float), para
 *   manter a mesma garantia de precisão que já temos no motor com
 *   decimal.js — o Postgres devolve numeric como string, e o código de
 *   aplicação deve envolver esses valores em `new Decimal(...)` ao ler.
 * - snake_case no banco, camelCase no código (Drizzle mapeia automaticamente
 *   quando declarado explicitamente como abaixo).
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const directionEnum = pgEnum("direction", ["CALL", "PUT", "DOJI"]);
export const dojiPolicyEnum = pgEnum("doji_policy", [
  "ignore",
  "count_as_loss",
  "count_as_tie",
]);
export const entryStrategyEnum = pgEnum("entry_strategy", ["same_direction", "contrarian"]);
export const patternStatusEnum = pgEnum("pattern_status", [
  "forte_e_ativo",
  "ativo",
  "perdendo_forca",
  "inativo",
  "amostra_insuficiente",
]);
export const dataProviderTypeEnum = pgEnum("data_provider_type", ["csv", "api"]);
export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "processing",
  "completed",
  "error",
  "cancelled",
]);
export const multiPeriodClassificationEnum = pgEnum("multi_period_classification", [
  "excelente",
  "forte",
  "bom",
  "observar",
  "descartar",
]);
export const multiPeriodRecommendationEnum = pgEnum("multi_period_recommendation", [
  "a_favor",
  "contra",
  "observar",
  "descartar",
]);
export const multiPeriodMomentumEnum = pgEnum("multi_period_momentum", [
  "fortalecendo",
  "estavel",
  "enfraquecendo",
  "possivel_inversao",
]);
export const backtestPlusModelTypeEnum = pgEnum("backtest_plus_model_type", [
  "top_score",
  "random",
  "rotation",
  "weighted_score",
  "diversified",
]);
export const backtestPlusEntryResultEnum = pgEnum("backtest_plus_entry_result", [
  "win",
  "loss",
  "tie",
  "invalid",
]);
export const backtestPlusInvalidReasonEnum = pgEnum("backtest_plus_invalid_reason", ["no_data", "doji"]);
export const multiPeriodInversionEnum = pgEnum("multi_period_inversion", [
  "none",
  "possible",
  "confirmed",
]);

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  // nulo para usuários criados via OAuth (Google) — não há senha própria a validar
  passwordHash: text("password_hash"),
  name: varchar("name", { length: 255 }).notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// DataProvider (fonte de dados configurada por um usuário: CSV, API futura)
// ---------------------------------------------------------------------------

export const dataProviders = pgTable("data_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: dataProviderTypeEnum("type").notNull(),
  config: jsonb("config").notNull().default({}), // parâmetros específicos do provider
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// CurrencyPair
// ---------------------------------------------------------------------------

export const currencyPairs = pgTable(
  "currency_pairs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: varchar("symbol", { length: 20 }).notNull(), // formato normalizado: "EUR/USD"
    baseCurrency: varchar("base_currency", { length: 10 }).notNull(),
    quoteCurrency: varchar("quote_currency", { length: 10 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("currency_pairs_symbol_idx").on(table.symbol)]
);

// ---------------------------------------------------------------------------
// Candle
// ---------------------------------------------------------------------------

export const candles = pgTable(
  "candles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    currencyPairId: uuid("currency_pair_id")
      .notNull()
      .references(() => currencyPairs.id, { onDelete: "cascade" }),
    timeframe: varchar("timeframe", { length: 10 }).notNull(), // "1m","5m","15m","1h" etc
    openTime: timestamp("open_time", { withTimezone: true }).notNull(), // UTC
    closeTime: timestamp("close_time", { withTimezone: true }).notNull(), // UTC
    open: numeric("open", { precision: 18, scale: 8 }).notNull(),
    high: numeric("high", { precision: 18, scale: 8 }).notNull(),
    low: numeric("low", { precision: 18, scale: 8 }).notNull(),
    close: numeric("close", { precision: 18, scale: 8 }).notNull(),
    volume: numeric("volume", { precision: 18, scale: 8 }),
    source: varchar("source", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // consulta mais comum do sistema: candles de um par+timeframe num intervalo de tempo
    index("candles_pair_tf_opentime_idx").on(table.currencyPairId, table.timeframe, table.openTime),
    // evita duplicidade do mesmo candle vindo da mesma fonte
    uniqueIndex("candles_unique_idx").on(
      table.currencyPairId,
      table.timeframe,
      table.openTime,
      table.source
    ),
  ]
);

// ---------------------------------------------------------------------------
// Analysis + AnalysisConfiguration
// ---------------------------------------------------------------------------

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    progressPct: integer("progress_pct").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("analyses_user_idx").on(table.userId), index("analyses_status_idx").on(table.status)]
);

export const analysisConfigurations = pgTable("analysis_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  analysisId: uuid("analysis_id")
    .notNull()
    .references(() => analyses.id, { onDelete: "cascade" }),
  currencyPairIds: jsonb("currency_pair_ids").notNull(), // array de UUIDs (múltiplos pares)
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  historicalDays: integer("historical_days"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  startTime: varchar("start_time", { length: 5 }), // "HH:mm" no timezone abaixo
  endTime: varchar("end_time", { length: 5 }),
  timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
  minRepetitionPct: numeric("min_repetition_pct", { precision: 5, scale: 2 }).notNull(),
  minValidDays: integer("min_valid_days").notNull(),
  // mantém só os N melhores horários no ranking final (ex: "top 10 horários acima de 70%");
  // null = sem limite, mantém todos os horários que passarem do % mínimo
  topN: integer("top_n"),
  weekdays: jsonb("weekdays"), // array de 1-7 (luxon) ou null = todos
  dataProviderId: uuid("data_provider_id").references(() => dataProviders.id),
  dojiTolerancePct: numeric("doji_tolerance_pct", { precision: 6, scale: 4 }).notNull().default("0"),
  dojiPolicy: dojiPolicyEnum("doji_policy").notNull().default("ignore"),
});

// ---------------------------------------------------------------------------
// PatternResult (resultado consolidado por par+timeframe+horário)
// ---------------------------------------------------------------------------

export const patternResults = pgTable(
  "pattern_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    currencyPairId: uuid("currency_pair_id")
      .notNull()
      .references(() => currencyPairs.id),
    timeframe: varchar("timeframe", { length: 10 }).notNull(),
    timeOfDay: varchar("time_of_day", { length: 5 }).notNull(), // "HH:mm"
    timezone: varchar("timezone", { length: 64 }).notNull(),
    totalDaysAnalyzed: integer("total_days_analyzed").notNull(),
    totalValid: integer("total_valid").notNull(),
    callCount: integer("call_count").notNull(),
    putCount: integer("put_count").notNull(),
    dojiCount: integer("doji_count").notNull(),
    predominantDirection: directionEnum("predominant_direction"),
    repetitionPct: numeric("repetition_pct", { precision: 5, scale: 2 }).notNull(),
    recent5Pct: numeric("recent_5_pct", { precision: 5, scale: 2 }),
    recent10Pct: numeric("recent_10_pct", { precision: 5, scale: 2 }),
    recent20PctPeriodPct: numeric("recent_20pct_period_pct", { precision: 5, scale: 2 }),
    currentStreak: integer("current_streak").notNull().default(0),
    lastOccurrenceDate: timestamp("last_occurrence_date", { withTimezone: true }),
    daysSinceLastOccurrence: integer("days_since_last_occurrence"),
    status: patternStatusEnum("status").notNull(),
    confidenceNote: text("confidence_note"),
    occurrences: jsonb("occurrences").notNull(), // snapshot serializado (auditável)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pattern_results_analysis_idx").on(table.analysisId),
    index("pattern_results_pair_tf_time_idx").on(
      table.currencyPairId,
      table.timeframe,
      table.timeOfDay
    ),
    index("pattern_results_repetition_pct_idx").on(table.repetitionPct),
    index("pattern_results_status_idx").on(table.status),
  ]
);

// ---------------------------------------------------------------------------
// MultiPeriodAnalysis (a "Análise Plus") + configuração + resultados
//
// Paralela à Analysis/PatternResult acima — não substitui nem altera a
// análise de período único, que continua existindo. Aqui o usuário informa
// só um "período máximo" (`maxDays`, múltiplo de 10, mínimo 50) e o motor
// (`src/lib/core/multi-period-analyzer.ts`) gera sozinho as janelas
// estruturais descendo de 10 em 10 até 50 dias, mais uma janela de momentum
// fixa em 40 dias — todas ancoradas na MESMA data de referência
// (`referenceDate`, capturada uma vez ao processar), buscando os candles do
// período máximo uma única vez e derivando as janelas menores por corte de
// data em memória (ver seção de performance do motor).
//
// Um "padrão" aqui é a chave PAR + HORÁRIO + DIREÇÃO (a direção é decidida
// pela janela máxima e testada nas demais — não são registros
// independentes por janela). `multi_period_windows` guarda uma linha por
// janela de cada padrão, incluindo as `occurrences` (dia -> CALL/PUT/DOJI),
// preparando a base para futuramente calcular sequências de WIN/LOSS sem
// precisar mudar o schema de novo.
// ---------------------------------------------------------------------------

export const multiPeriodAnalyses = pgTable(
  "multi_period_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    progressPct: integer("progress_pct").notNull().default(0),
    errorMessage: text("error_message"),
    // capturada uma única vez ao iniciar o processamento — todas as janelas
    // (estruturais e a de momentum) terminam nesta mesma data/hora, nunca
    // usam candles posteriores a ela (sem look-ahead, pronto para backtest).
    referenceDate: timestamp("reference_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("multi_period_analyses_user_idx").on(table.userId),
    index("multi_period_analyses_status_idx").on(table.status),
  ]
);

export const multiPeriodAnalysisConfigurations = pgTable(
  "multi_period_analysis_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => multiPeriodAnalyses.id, { onDelete: "cascade" }),
    currencyPairIds: jsonb("currency_pair_ids").notNull(),
    timeframe: varchar("timeframe", { length: 10 }).notNull(),
    // período máximo EFETIVO usado pelo motor — sempre múltiplo de 10,
    // mínimo 50 (arredondado pra baixo quando vem de startDate/endDate). As
    // janelas estruturais são derivadas automaticamente (maxDays,
    // maxDays-10, ... até >=50) + uma janela de momentum fixa em 40 dias.
    maxDays: integer("max_days").notNull(),
    // preenchidos só quando o usuário escolheu "período específico" (em vez
    // de "últimos N dias a partir de agora") — mesmo padrão de
    // `analysisConfigurations.startDate/endDate`. `endDate`, quando
    // presente, também vira a `referenceDate` do processamento (fixa, não
    // rola com o tempo a cada reprocessamento).
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    startTime: varchar("start_time", { length: 5 }),
    endTime: varchar("end_time", { length: 5 }),
    timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
    weekdays: jsonb("weekdays"),
    dataProviderId: uuid("data_provider_id").references(() => dataProviders.id),
    dojiTolerancePct: numeric("doji_tolerance_pct", { precision: 6, scale: 4 }).notNull().default("0"),
    dojiPolicy: dojiPolicyEnum("doji_policy").notNull().default("ignore"),
    // % mínimo, na direção escolhida, para uma janela estrutural contar como
    // "confirmada" no cálculo de persistência (seção 5 do motor).
    persistenceThresholdPct: numeric("persistence_threshold_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("70"),
  }
);

export const multiPeriodPatternResults = pgTable(
  "multi_period_pattern_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => multiPeriodAnalyses.id, { onDelete: "cascade" }),
    currencyPairId: uuid("currency_pair_id")
      .notNull()
      .references(() => currencyPairs.id),
    timeframe: varchar("timeframe", { length: 10 }).notNull(),
    timeOfDay: varchar("time_of_day", { length: 5 }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    direction: directionEnum("direction").notNull(), // sempre CALL ou PUT, nunca DOJI

    structuralAverage: numeric("structural_average", { precision: 5, scale: 2 }).notNull(),
    confidenceScore: integer("confidence_score").notNull(), // 0-100
    classification: multiPeriodClassificationEnum("classification").notNull(),
    recommendation: multiPeriodRecommendationEnum("recommendation").notNull(),
    momentumTrend: multiPeriodMomentumEnum("momentum_trend").notNull(),
    inversionState: multiPeriodInversionEnum("inversion_state").notNull(),

    persistenceConfirmed: integer("persistence_confirmed").notNull(),
    persistenceTotal: integer("persistence_total").notNull(),
    persistencePercentage: numeric("persistence_percentage", { precision: 5, scale: 2 }).notNull(),
    stabilityRange: numeric("stability_range", { precision: 6, scale: 2 }).notNull(),
    stabilityStdDev: numeric("stability_std_dev", { precision: 6, scale: 2 }).notNull(),
    // ocorrências válidas na MAIOR janela estrutural — "dias válidos" pra
    // exibição, mesmo sentido de pattern_results.total_valid. NÃO confundir
    // com sampleMin (menor amostra entre as janelas, usado só pro score).
    totalValid: integer("total_valid").notNull(),
    sampleMin: integer("sample_min").notNull(),

    // subtotais do score — DEVEM somar `confidenceScore` (30+30+20+15+5 = 100 no máximo)
    scorePersistence: numeric("score_persistence", { precision: 5, scale: 2 }).notNull(),
    scoreFrequency: numeric("score_frequency", { precision: 5, scale: 2 }).notNull(),
    scoreStability: numeric("score_stability", { precision: 5, scale: 2 }).notNull(),
    scoreSample: numeric("score_sample", { precision: 5, scale: 2 }).notNull(),
    scoreMomentum: numeric("score_momentum", { precision: 5, scale: 2 }).notNull(),

    recentMomentumFrequency: numeric("recent_momentum_frequency", { precision: 5, scale: 2 }).notNull(),
    recentMomentumOppositeFrequency: numeric("recent_momentum_opposite_frequency", {
      precision: 5,
      scale: 2,
    }).notNull(),
    recentMomentumValidSamples: integer("recent_momentum_valid_samples").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("multi_period_pattern_results_analysis_idx").on(table.analysisId),
    index("multi_period_pattern_results_score_idx").on(table.confidenceScore),
  ]
);

export const multiPeriodWindows = pgTable(
  "multi_period_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patternResultId: uuid("pattern_result_id")
      .notNull()
      .references(() => multiPeriodPatternResults.id, { onDelete: "cascade" }),
    days: integer("days").notNull(),
    isMomentum: boolean("is_momentum").notNull().default(false), // true só para a janela de 40D
    frequency: numeric("frequency", { precision: 5, scale: 2 }).notNull(), // % da direção do padrão nesta janela
    validSamples: integer("valid_samples").notNull(),
    callCount: integer("call_count").notNull(),
    putCount: integer("put_count").notNull(),
    dojiCount: integer("doji_count").notNull(),
    // dia -> CALL/PUT/DOJI nesta janela — mesma forma de `pattern_results.occurrences`,
    // guardado para permitir calcular no futuro maxConsecutiveWins/Losses sem migration nova.
    occurrences: jsonb("occurrences").notNull(),
  },
  (table) => [index("multi_period_windows_pattern_result_idx").on(table.patternResultId)]
);

// ---------------------------------------------------------------------------
// Backtest + BacktestOperation
// ---------------------------------------------------------------------------

export const backtests = pgTable(
  "backtests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // opcional: não é pedido na criação, o usuário pode nomear depois pela tela
    name: varchar("name", { length: 60 }),
    patternResultIds: jsonb("pattern_result_ids").notNull(), // padrões selecionados
    entryStrategy: entryStrategyEnum("entry_strategy").notNull(),
    payoutPct: numeric("payout_pct", { precision: 5, scale: 2 }).notNull(),
    initialBankroll: numeric("initial_bankroll", { precision: 18, scale: 2 }).notNull(),
    // entrada e lucro mínimo de recuperação são derivados automaticamente (calculateAutoRecovery)
    // a partir desse percentual — não são mais informados pelo usuário.
    maxExposurePct: numeric("max_exposure_pct", { precision: 5, scale: 2 }).notNull(),
    martingaleLevels: integer("martingale_levels").notNull().default(0),
    dailyLossLimit: numeric("daily_loss_limit", { precision: 18, scale: 2 }),
    maxOperationsPerDay: integer("max_operations_per_day"),
    dojiPolicy: dojiPolicyEnum("doji_policy").notNull().default("ignore"),
    oneEntryPerTimeSlot: boolean("one_entry_per_time_slot").notNull().default(true),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    progressPct: integer("progress_pct").notNull().default(0),
    errorMessage: text("error_message"),
    // resultados consolidados (preenchidos ao concluir)
    finalBankroll: numeric("final_bankroll", { precision: 18, scale: 2 }),
    totalOperations: integer("total_operations"),
    maxDrawdown: numeric("max_drawdown", { precision: 18, scale: 2 }),
    profitFactor: numeric("profit_factor", { precision: 10, scale: 4 }),
    summary: jsonb("summary"), // demais métricas agregadas (por moeda/horário/dia da semana/mês)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("backtests_user_idx").on(table.userId), index("backtests_status_idx").on(table.status)]
);

export const backtestOperations = pgTable(
  "backtest_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    backtestId: uuid("backtest_id")
      .notNull()
      .references(() => backtests.id, { onDelete: "cascade" }),
    operationDate: timestamp("operation_date", { withTimezone: true }).notNull(),
    currencyPairId: uuid("currency_pair_id").notNull().references(() => currencyPairs.id),
    timeOfDay: varchar("time_of_day", { length: 5 }).notNull(),
    entryDirection: directionEnum("entry_direction").notNull(),
    actualDirection: directionEnum("actual_direction").notNull(),
    martingaleLevelReached: integer("martingale_level_reached").notNull().default(0),
    entryValue: numeric("entry_value", { precision: 18, scale: 2 }).notNull(),
    result: varchar("result", { length: 10 }).notNull(), // "win" | "loss" | "tie"
    profitLoss: numeric("profit_loss", { precision: 18, scale: 2 }).notNull(),
    bankrollAfter: numeric("bankroll_after", { precision: 18, scale: 2 }).notNull(),
    dailyCumulativeProfitLoss: numeric("daily_cumulative_profit_loss", { precision: 18, scale: 2 })
      .notNull()
      .default("0.00"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("backtest_operations_backtest_idx").on(table.backtestId),
    index("backtest_operations_date_idx").on(table.operationDate),
  ]
);

// ---------------------------------------------------------------------------
// BacktestPlus (parte do resultado JÁ CONGELADO de uma Análise Plus — nunca
// recalcula Confidence Score/ranking/direção com dados futuros, ver
// `src/lib/backtest-plus/`). Diferente do Backtest normal (que re-ranqueia
// os horários dia a dia): aqui o pool de 10 candidatos é FIXO desde a
// criação, snapshotado em `backtestPlusCandidates`, e o que varia dia a dia
// é só QUAL SUBCONJUNTO de N desses 10 cada um dos 5 modelos escolhe.
// ---------------------------------------------------------------------------

export const backtestPlus = pgTable(
  "backtest_plus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceAnalysisId: uuid("source_analysis_id")
      .notNull()
      .references(() => multiPeriodAnalyses.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 60 }), // opcional, mesmo padrão de Backtest/BankrollLedger
    // data-base CONGELADA (a referenceDate da Análise Plus origem no momento
    // da criação) — todo o snapshot em `backtestPlusCandidates` reflete o
    // estado da análise EXATAMENTE nesta data, mesmo que a análise seja
    // reprocessada depois.
    referenceDate: timestamp("reference_date", { withTimezone: true }).notNull(),
    entriesPerDay: integer("entries_per_day").notNull(), // 4 ou 5
    forwardDaysRequested: integer("forward_days_requested").notNull(), // 1-5, pedido pelo usuário
    randomSeed: integer("random_seed").notNull(), // gerado uma vez na criação; usado por RANDOM e WEIGHTED_SCORE
    status: jobStatusEnum("status").notNull().default("pending"),
    progressPct: integer("progress_pct").notNull().default(0),
    errorMessage: text("error_message"),
    // período EFETIVAMENTE testado (dias operacionais válidos encontrados —
    // pode ser < forwardDaysRequested se faltar candle na ponta, nunca mais).
    effectiveStartDate: timestamp("effective_start_date", { withTimezone: true }),
    effectiveEndDate: timestamp("effective_end_date", { withTimezone: true }),
    daysTested: integer("days_tested"),
    bestModel: backtestPlusModelTypeEnum("best_model"), // seção 43: menor zeroOfNRate > maior dailySuccessRate > ...
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("backtest_plus_user_idx").on(table.userId),
    index("backtest_plus_source_analysis_idx").on(table.sourceAnalysisId),
  ]
);

// snapshot do pool de 10 candidatos — cada coluna é uma CÓPIA do dado da
// Análise Plus no momento da criação, não uma referência viva. `sourceResultId`
// é mantido só para auditoria (não é reconsultado para calcular nada).
export const backtestPlusCandidates = pgTable(
  "backtest_plus_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    backtestId: uuid("backtest_id")
      .notNull()
      .references(() => backtestPlus.id, { onDelete: "cascade" }),
    sourceResultId: uuid("source_result_id")
      .notNull()
      .references(() => multiPeriodPatternResults.id),
    poolRank: integer("pool_rank").notNull(), // 0-9 — ordem de seleção/ranking original, usada como desempate determinístico
    currencyPairId: uuid("currency_pair_id").notNull().references(() => currencyPairs.id),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    timeOfDay: varchar("time_of_day", { length: 5 }).notNull(),
    timeframe: varchar("timeframe", { length: 10 }).notNull(),
    direction: directionEnum("direction").notNull(), // sempre CALL ou PUT (nunca DOJI — é a direção do padrão)
    confidenceScore: integer("confidence_score").notNull(),
    classification: multiPeriodClassificationEnum("classification").notNull(),
    recommendation: multiPeriodRecommendationEnum("recommendation").notNull(),
    momentumTrend: multiPeriodMomentumEnum("momentum_trend").notNull(),
    structuralAverage: numeric("structural_average", { precision: 5, scale: 2 }).notNull(),
  },
  (table) => [index("backtest_plus_candidates_backtest_idx").on(table.backtestId)]
);

// uma linha por modelo (sempre 5 por backtest) — métricas agregadas, seção 12/13.
export const backtestPlusModels = pgTable(
  "backtest_plus_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    backtestId: uuid("backtest_id")
      .notNull()
      .references(() => backtestPlus.id, { onDelete: "cascade" }),
    modelType: backtestPlusModelTypeEnum("model_type").notNull(),
    rankPosition: integer("rank_position").notNull(), // 1 = melhor modelo (seção 43)

    daysTested: integer("days_tested").notNull(),
    successfulDays: integer("successful_days").notNull(),
    failedDays: integer("failed_days").notNull(), // == zeroOfN
    dailySuccessRate: numeric("daily_success_rate", { precision: 6, scale: 4 }).notNull(),
    zeroOfNRate: numeric("zero_of_n_rate", { precision: 6, scale: 4 }).notNull(),

    totalEntries: integer("total_entries").notNull(),
    totalWins: integer("total_wins").notNull(),
    totalLosses: integer("total_losses").notNull(),
    totalTies: integer("total_ties").notNull(),
    invalidEntries: integer("invalid_entries").notNull(),
    individualHitRate: numeric("individual_hit_rate", { precision: 6, scale: 4 }).notNull(),

    averageEntriesUntilFirstWin: numeric("average_entries_until_first_win", { precision: 6, scale: 3 }),
    medianEntriesUntilFirstWin: numeric("median_entries_until_first_win", { precision: 6, scale: 3 }),

    firstWinAt1: integer("first_win_at_1").notNull(),
    firstWinAt2: integer("first_win_at_2").notNull(),
    firstWinAt3: integer("first_win_at_3").notNull(),
    firstWinAt4: integer("first_win_at_4").notNull(),
    firstWinAt5: integer("first_win_at_5"), // null quando entriesPerDay=4
    zeroOfN: integer("zero_of_n").notNull(),

    coverageAt1: numeric("coverage_at_1", { precision: 6, scale: 4 }).notNull(),
    coverageAt2: numeric("coverage_at_2", { precision: 6, scale: 4 }).notNull(),
    coverageAt3: numeric("coverage_at_3", { precision: 6, scale: 4 }).notNull(),
    coverageAt4: numeric("coverage_at_4", { precision: 6, scale: 4 }).notNull(),
    coverageAt5: numeric("coverage_at_5", { precision: 6, scale: 4 }), // null quando entriesPerDay=4
  },
  (table) => [index("backtest_plus_models_backtest_idx").on(table.backtestId)]
);

// uma linha por entrada avaliada (modelo × dia × posição, até 5 modelos × 5 dias × 5 entradas = 125 linhas no máximo).
export const backtestPlusEntries = pgTable(
  "backtest_plus_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => backtestPlusModels.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => backtestPlusCandidates.id, { onDelete: "cascade" }),
    targetDate: timestamp("target_date", { withTimezone: true }).notNull(), // dia operacional pura (meia-noite UTC, mesma convenção de operationDate)
    entryOrder: integer("entry_order").notNull(), // 1..N, posição cronológica (por horário real) dentro do dia
    result: backtestPlusEntryResultEnum("result").notNull(),
    invalidReason: backtestPlusInvalidReasonEnum("invalid_reason"), // só quando result="invalid"
    candleOpenTime: timestamp("candle_open_time", { withTimezone: true }),
    candleOpen: numeric("candle_open", { precision: 18, scale: 8 }),
    candleHigh: numeric("candle_high", { precision: 18, scale: 8 }),
    candleLow: numeric("candle_low", { precision: 18, scale: 8 }),
    candleClose: numeric("candle_close", { precision: 18, scale: 8 }),
    actualDirection: directionEnum("actual_direction"), // null quando invalid por NO_DATA
  },
  (table) => [
    index("backtest_plus_entries_model_idx").on(table.modelId),
    index("backtest_plus_entries_target_date_idx").on(table.targetDate),
  ]
);

// ---------------------------------------------------------------------------
// BankrollLedger + BankrollLedgerEntry
// (planilha MANUAL de operações — diferente do Backtest: o resultado de cada
// linha é marcado pelo usuário, não calculado a partir do histórico de
// candles. Vinculada a UMA análise (de período único OU Plus — exatamente
// uma das duas FKs abaixo fica preenchida, validado na API, não no banco),
// mas essa vinculação pode ser trocada depois — inclusive de um tipo pro
// outro — os horários disponíveis pra cada entry são sempre os da análise
// vinculada NO MOMENTO, e cada entry já guarda seu próprio
// patternResultId/multiPeriodPatternResultId, então trocar a análise não
// afeta o que já foi lançado.)
// ---------------------------------------------------------------------------

export const bankrollLedgers = pgTable(
  "bankroll_ledgers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // exatamente um dos dois é preenchido — nunca os dois, nunca nenhum.
    analysisId: uuid("analysis_id").references(() => analyses.id, { onDelete: "cascade" }),
    multiPeriodAnalysisId: uuid("multi_period_analysis_id").references(() => multiPeriodAnalyses.id, {
      onDelete: "cascade",
    }),
    name: varchar("name", { length: 60 }), // opcional, renomeável depois (mesmo padrão do Backtest)
    initialBankroll: numeric("initial_bankroll", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("bankroll_ledgers_user_idx").on(table.userId)]
);

export const bankrollLedgerEntries = pgTable(
  "bankroll_ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => bankrollLedgers.id, { onDelete: "cascade" }),
    // exatamente um dos dois é preenchido, conforme o tipo da análise vinculada ao ledger no momento em que a linha foi criada.
    patternResultId: uuid("pattern_result_id").references(() => patternResults.id),
    multiPeriodPatternResultId: uuid("multi_period_pattern_result_id").references(() => multiPeriodPatternResults.id),
    date: timestamp("date", { withTimezone: true }).notNull(), // data pura (meia-noite UTC), mesma convenção de operationDate
    payoutPct: numeric("payout_pct", { precision: 5, scale: 2 }).notNull(),
    entryValue: numeric("entry_value", { precision: 18, scale: 2 }).notNull(),
    result: varchar("result", { length: 10 }).notNull(), // "win" | "loss" | "tie"
    profitLoss: numeric("profit_loss", { precision: 18, scale: 2 }).notNull(), // derivado, recalculado a cada save
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("bankroll_ledger_entries_ledger_idx").on(table.ledgerId)]
);

// ---------------------------------------------------------------------------
// BankrollConfiguration + MartingaleCalculation + MartingaleLevel
// (histórico da Calculadora de Entradas)
// ---------------------------------------------------------------------------

export const bankrollConfigurations = pgTable("bankroll_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  bankroll: numeric("bankroll", { precision: 18, scale: 2 }).notNull(),
  payoutPct: numeric("payout_pct", { precision: 5, scale: 2 }).notNull(),
  maxExposurePct: numeric("max_exposure_pct", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const martingaleCalculations = pgTable(
  "martingale_calculations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    bankrollConfigurationId: uuid("bankroll_configuration_id").references(
      () => bankrollConfigurations.id
    ),
    mode: varchar("mode", { length: 20 }).notNull(), // "initial_entry" | "auto_split"
    bankroll: numeric("bankroll", { precision: 18, scale: 2 }).notNull(),
    payoutPct: numeric("payout_pct", { precision: 5, scale: 2 }).notNull(),
    initialEntry: numeric("initial_entry", { precision: 18, scale: 2 }),
    minProfit: numeric("min_profit", { precision: 18, scale: 2 }).notNull(),
    martingaleLevels: integer("martingale_levels").notNull(),
    maxExposurePct: numeric("max_exposure_pct", { precision: 5, scale: 2 }),
    totalCapitalRequired: numeric("total_capital_required", { precision: 18, scale: 2 }).notNull(),
    pctBankrollExposed: numeric("pct_bankroll_exposed", { precision: 5, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("martingale_calculations_user_idx").on(table.userId)]
);

export const martingaleLevels = pgTable(
  "martingale_levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calculationId: uuid("calculation_id")
      .notNull()
      .references(() => martingaleCalculations.id, { onDelete: "cascade" }),
    levelIndex: integer("level_index").notNull(), // 0 = entrada inicial, 1..5 = martingale
    levelName: varchar("level_name", { length: 50 }).notNull(),
    entryValue: numeric("entry_value", { precision: 18, scale: 2 }).notNull(),
    accumulatedLossesBefore: numeric("accumulated_losses_before", {
      precision: 18,
      scale: 2,
    }).notNull(),
    grossProfitIfWin: numeric("gross_profit_if_win", { precision: 18, scale: 2 }).notNull(),
    netProfitAfterRecovery: numeric("net_profit_after_recovery", {
      precision: 18,
      scale: 2,
    }).notNull(),
    accumulatedExposure: numeric("accumulated_exposure", { precision: 18, scale: 2 }).notNull(),
    pctOfBankrollUsed: numeric("pct_of_bankroll_used", { precision: 5, scale: 2 }).notNull(),
    remainingBalanceIfLost: numeric("remaining_balance_if_lost", {
      precision: 18,
      scale: 2,
    }).notNull(),
    bankrollSupportsNextLevel: boolean("bankroll_supports_next_level").notNull(),
  },
  (table) => [index("martingale_levels_calculation_idx").on(table.calculationId)]
);

// ---------------------------------------------------------------------------
// ImportJob (processamento assíncrono de importação de candles)
// ---------------------------------------------------------------------------

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    dataProviderId: uuid("data_provider_id")
      .notNull()
      .references(() => dataProviders.id),
    fileName: varchar("file_name", { length: 255 }),
    status: jobStatusEnum("status").notNull().default("pending"),
    progressPct: integer("progress_pct").notNull().default(0),
    totalRows: integer("total_rows"),
    importedRows: integer("imported_rows"),
    duplicateRows: integer("duplicate_rows"),
    errorRows: integer("error_rows"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("import_jobs_user_idx").on(table.userId),
    index("import_jobs_status_idx").on(table.status),
  ]
);

// ---------------------------------------------------------------------------
// AuditLog
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata"),
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_user_idx").on(table.userId),
    index("audit_logs_action_idx").on(table.action),
  ]
);

// ---------------------------------------------------------------------------
// Relations (para consultas aninhadas via db.query.*)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  dataProviders: many(dataProviders),
  analyses: many(analyses),
  multiPeriodAnalyses: many(multiPeriodAnalyses),
  backtests: many(backtests),
  backtestPlus: many(backtestPlus),
  bankrollLedgers: many(bankrollLedgers),
  bankrollConfigurations: many(bankrollConfigurations),
  martingaleCalculations: many(martingaleCalculations),
}));

export const analysesRelations = relations(analyses, ({ one, many }) => ({
  user: one(users, { fields: [analyses.userId], references: [users.id] }),
  configuration: one(analysisConfigurations, {
    fields: [analyses.id],
    references: [analysisConfigurations.analysisId],
  }),
  patternResults: many(patternResults),
}));

export const multiPeriodAnalysesRelations = relations(multiPeriodAnalyses, ({ one, many }) => ({
  user: one(users, { fields: [multiPeriodAnalyses.userId], references: [users.id] }),
  configuration: one(multiPeriodAnalysisConfigurations, {
    fields: [multiPeriodAnalyses.id],
    references: [multiPeriodAnalysisConfigurations.analysisId],
  }),
  patternResults: many(multiPeriodPatternResults),
}));

export const multiPeriodPatternResultsRelations = relations(multiPeriodPatternResults, ({ one, many }) => ({
  analysis: one(multiPeriodAnalyses, {
    fields: [multiPeriodPatternResults.analysisId],
    references: [multiPeriodAnalyses.id],
  }),
  windows: many(multiPeriodWindows),
}));

export const multiPeriodWindowsRelations = relations(multiPeriodWindows, ({ one }) => ({
  patternResult: one(multiPeriodPatternResults, {
    fields: [multiPeriodWindows.patternResultId],
    references: [multiPeriodPatternResults.id],
  }),
}));

export const backtestsRelations = relations(backtests, ({ one, many }) => ({
  user: one(users, { fields: [backtests.userId], references: [users.id] }),
  operations: many(backtestOperations),
}));

export const backtestPlusRelations = relations(backtestPlus, ({ one, many }) => ({
  user: one(users, { fields: [backtestPlus.userId], references: [users.id] }),
  sourceAnalysis: one(multiPeriodAnalyses, {
    fields: [backtestPlus.sourceAnalysisId],
    references: [multiPeriodAnalyses.id],
  }),
  candidates: many(backtestPlusCandidates),
  models: many(backtestPlusModels),
}));

export const backtestPlusCandidatesRelations = relations(backtestPlusCandidates, ({ one, many }) => ({
  backtest: one(backtestPlus, { fields: [backtestPlusCandidates.backtestId], references: [backtestPlus.id] }),
  sourceResult: one(multiPeriodPatternResults, {
    fields: [backtestPlusCandidates.sourceResultId],
    references: [multiPeriodPatternResults.id],
  }),
  entries: many(backtestPlusEntries),
}));

export const backtestPlusModelsRelations = relations(backtestPlusModels, ({ one, many }) => ({
  backtest: one(backtestPlus, { fields: [backtestPlusModels.backtestId], references: [backtestPlus.id] }),
  entries: many(backtestPlusEntries),
}));

export const backtestPlusEntriesRelations = relations(backtestPlusEntries, ({ one }) => ({
  model: one(backtestPlusModels, { fields: [backtestPlusEntries.modelId], references: [backtestPlusModels.id] }),
  candidate: one(backtestPlusCandidates, {
    fields: [backtestPlusEntries.candidateId],
    references: [backtestPlusCandidates.id],
  }),
}));

export const bankrollLedgersRelations = relations(bankrollLedgers, ({ one, many }) => ({
  user: one(users, { fields: [bankrollLedgers.userId], references: [users.id] }),
  analysis: one(analyses, { fields: [bankrollLedgers.analysisId], references: [analyses.id] }),
  multiPeriodAnalysis: one(multiPeriodAnalyses, {
    fields: [bankrollLedgers.multiPeriodAnalysisId],
    references: [multiPeriodAnalyses.id],
  }),
  entries: many(bankrollLedgerEntries),
}));

export const bankrollLedgerEntriesRelations = relations(bankrollLedgerEntries, ({ one }) => ({
  ledger: one(bankrollLedgers, { fields: [bankrollLedgerEntries.ledgerId], references: [bankrollLedgers.id] }),
  patternResult: one(patternResults, {
    fields: [bankrollLedgerEntries.patternResultId],
    references: [patternResults.id],
  }),
  multiPeriodPatternResult: one(multiPeriodPatternResults, {
    fields: [bankrollLedgerEntries.multiPeriodPatternResultId],
    references: [multiPeriodPatternResults.id],
  }),
}));

export const martingaleCalculationsRelations = relations(martingaleCalculations, ({ many }) => ({
  levels: many(martingaleLevels),
}));

/**
 * Schema Drizzle ORM, dialeto Postgres, pensado para rodar em Neon
 * (serverless Postgres). Cobre as entidades do domínio descritas no
 * briefing original: User, DataProvider, CurrencyPair, Candle, Analysis,
 * AnalysisConfiguration, PatternResult, Backtest, BacktestOperation,
 * BankrollLedger, BankrollLedgerEntry, BankrollConfiguration,
 * MartingaleCalculation, MartingaleLevel, ImportJob, AuditLog.
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
export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "processing",
  "completed",
  "error",
  "cancelled",
]);
export const dataProviderTypeEnum = pgEnum("data_provider_type", ["csv", "api"]);

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
// BankrollLedger + BankrollLedgerEntry
// (planilha MANUAL de operações — diferente do Backtest: o resultado de cada
// linha é marcado pelo usuário, não calculado a partir do histórico de
// candles. Vinculada a UMA análise: cada entry só pode usar um dos horários
// selecionados na hora de criar o ledger.)
// ---------------------------------------------------------------------------

export const bankrollLedgers = pgTable(
  "bankroll_ledgers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    analysisId: uuid("analysis_id").notNull().references(() => analyses.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 60 }), // opcional, renomeável depois (mesmo padrão do Backtest)
    patternResultIds: jsonb("pattern_result_ids").notNull(), // horários selecionados na análise
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
    patternResultId: uuid("pattern_result_id")
      .notNull()
      .references(() => patternResults.id),
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
  backtests: many(backtests),
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

export const backtestsRelations = relations(backtests, ({ one, many }) => ({
  user: one(users, { fields: [backtests.userId], references: [users.id] }),
  operations: many(backtestOperations),
}));

export const bankrollLedgersRelations = relations(bankrollLedgers, ({ one, many }) => ({
  user: one(users, { fields: [bankrollLedgers.userId], references: [users.id] }),
  analysis: one(analyses, { fields: [bankrollLedgers.analysisId], references: [analyses.id] }),
  entries: many(bankrollLedgerEntries),
}));

export const bankrollLedgerEntriesRelations = relations(bankrollLedgerEntries, ({ one }) => ({
  ledger: one(bankrollLedgers, { fields: [bankrollLedgerEntries.ledgerId], references: [bankrollLedgers.id] }),
  patternResult: one(patternResults, {
    fields: [bankrollLedgerEntries.patternResultId],
    references: [patternResults.id],
  }),
}));

export const martingaleCalculationsRelations = relations(martingaleCalculations, ({ many }) => ({
  levels: many(martingaleLevels),
}));

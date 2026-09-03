/**
 * Orquestrador puro do Backtest Plus: roda os 5 modelos sobre o MESMO pool
 * congelado de 10 candidatos e os MESMOS dias futuros válidos, e devolve o
 * dia-a-dia + métricas agregadas de cada um.
 *
 * Puro (sem I/O) — mesma separação de `runBacktest`/`processBacktest`: este
 * arquivo só recebe candles já carregadas e config, e devolve o resultado;
 * `backtest-plus-service.ts` é quem faz I/O de banco em cima disto.
 *
 * Determinismo (seção 8/49): cada modelo que usa aleatoriedade recebe seu
 * PRÓPRIO gerador seeded, derivado do MESMO `randomSeed` base com um offset
 * fixo e documentado por modelo — assim RANDOM e WEIGHTED_SCORE não
 * competem pela mesma sequência de números (mudar `entriesPerDay` não
 * desloca a sequência que o outro consome), e o resultado inteiro do
 * backtest é 100% reproduzível reprocessando com o mesmo seed + mesma
 * config. Nunca usa `Math.random()`.
 */
import { Decimal } from "decimal.js";
import type { Candle, DojiPolicy } from "@/lib/core/candle-classifier";
import { createSeededRandom } from "./seeded-random";
import { selectCandidates, type SelectionContext, type WeightedScoreConfig } from "./selection-strategies";
import { indexCandlesForResolution, resolveEntry, type ResolvedEntry } from "./resolve-entries";
import { aggregateMetrics, type ModelMetrics } from "./metrics";
import { BACKTEST_PLUS_MODEL_TYPES, type BacktestPlusModelType, type PoolCandidate } from "./types";
import type { DiversificationConfig } from "./diversification";

// Offsets arbitrários, fixos e documentados — só existem para que RANDOM e
// WEIGHTED_SCORE não compartilhem a mesma sequência do PRNG. Não têm
// nenhum significado estatístico.
const RANDOM_MODEL_SEED_OFFSET = 0x1000_0001;
const WEIGHTED_SCORE_SEED_OFFSET = 0x2000_0002;

export interface BacktestPlusEngineConfig {
  /** Pool congelado — exatamente 10 candidatos (validado na camada de API/serviço, não aqui). */
  pool: PoolCandidate[];
  entriesPerDay: 4 | 5;
  /** Dias futuros válidos já resolvidos por `findForwardValidDays` — o motor não decide quais dias existem, só os consome. */
  forwardDays: string[];
  randomSeed: number;
  timeframe: string;
  timezone: string;
  dojiTolerancePct: Decimal;
  dojiPolicy: DojiPolicy;
  /** Candles já carregadas via `DbCandleProvider` pelo chamador — cobrindo os `forwardDays`. */
  candles: Candle[];
  weightedScoreConfig?: WeightedScoreConfig;
  diversificationConfig?: DiversificationConfig;
}

export interface ModelDayResult {
  date: string;
  entries: ResolvedEntry[];
}

export interface ModelRunResult {
  model: BacktestPlusModelType;
  days: ModelDayResult[];
  metrics: ModelMetrics;
}

export interface BacktestPlusEngineResult {
  /** Sempre os 5 modelos, na ordem de `BACKTEST_PLUS_MODEL_TYPES`. */
  models: ModelRunResult[];
}

export function runBacktestPlus(config: BacktestPlusEngineConfig): BacktestPlusEngineResult {
  const candleIndex = indexCandlesForResolution(config.candles, config.timeframe, config.timezone);
  const randomRng = createSeededRandom((config.randomSeed + RANDOM_MODEL_SEED_OFFSET) >>> 0);
  const weightedRng = createSeededRandom((config.randomSeed + WEIGHTED_SCORE_SEED_OFFSET) >>> 0);

  const models: ModelRunResult[] = [];

  for (const modelType of BACKTEST_PLUS_MODEL_TYPES) {
    const usageCount = new Map<string, number>();
    const context: SelectionContext = {
      rng: modelType === "weighted_score" ? weightedRng : randomRng,
      usageCount,
      weightedScoreConfig: config.weightedScoreConfig,
      diversificationConfig: config.diversificationConfig,
    };

    const days: ModelDayResult[] = [];
    for (const day of config.forwardDays) {
      const selected = selectCandidates(modelType, config.pool, config.entriesPerDay, context);
      const entries = selected.map((candidate, idx) =>
        resolveEntry(candidate, idx + 1, day, candleIndex, config.dojiTolerancePct, config.dojiPolicy)
      );
      days.push({ date: day, entries });
      for (const c of selected) usageCount.set(c.id, (usageCount.get(c.id) ?? 0) + 1);
    }

    const metrics = aggregateMetrics(
      days.map((d) => ({ date: d.date, entries: d.entries.map((e) => ({ entryOrder: e.entryOrder, result: e.result })) })),
      config.entriesPerDay
    );

    models.push({ model: modelType, days, metrics });
  }

  return { models };
}

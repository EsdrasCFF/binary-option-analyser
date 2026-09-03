import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { Candle, Direction, DojiPolicy, makeCandle } from "@/lib/core/candle-classifier";
import { runBacktestPlus, type BacktestPlusEngineConfig } from "../backtest-plus-engine";
import { BACKTEST_PLUS_MODEL_TYPES } from "../types";
import type { PoolCandidate } from "../types";

const TIMEFRAME = "5m";
const TIMEZONE = "UTC";

function pool(): PoolCandidate[] {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`,
    symbol: i % 2 === 0 ? "EUR/USD" : "GBP/USD",
    timeOfDay: `${String(7 + i).padStart(2, "0")}:00`,
    direction: i % 3 === 0 ? "PUT" : "CALL",
    confidenceScore: 100 - i,
    poolRank: i,
  }));
}

function candleFor(symbol: string, day: string, hhmm: string, direction: Direction): Candle {
  const openTime = new Date(`${day}T${hhmm}:00Z`);
  const open = "1.10000";
  const close = direction === Direction.CALL ? "1.10100" : direction === Direction.PUT ? "1.09900" : open;
  return makeCandle({
    symbol,
    timeframe: TIMEFRAME,
    openTime,
    closeTime: new Date(openTime.getTime() + 5 * 60 * 1000),
    open,
    high: "1.10200",
    low: "1.09800",
    close,
    volume: "100",
    source: "test",
  });
}

function candlesForDays(days: string[], candidates: PoolCandidate[]): Candle[] {
  const candles: Candle[] = [];
  for (const day of days) {
    for (const c of candidates) {
      const actual = c.direction === "CALL" ? Direction.CALL : Direction.PUT; // sempre WIN nesse fixture-base
      candles.push(candleFor(c.symbol, day, c.timeOfDay, actual));
    }
  }
  return candles;
}

function baseConfig(overrides: Partial<BacktestPlusEngineConfig> = {}): BacktestPlusEngineConfig {
  const p = pool();
  const forwardDays = ["2026-01-05", "2026-01-06", "2026-01-07"];
  return {
    pool: p,
    entriesPerDay: 5,
    forwardDays,
    randomSeed: 42,
    timeframe: TIMEFRAME,
    timezone: TIMEZONE,
    dojiTolerancePct: new Decimal(0),
    dojiPolicy: DojiPolicy.IGNORE,
    candles: candlesForDays(forwardDays, p),
    ...overrides,
  };
}

describe("runBacktestPlus", () => {
  it("roda exatamente os 5 modelos, na ordem de BACKTEST_PLUS_MODEL_TYPES", () => {
    const result = runBacktestPlus(baseConfig());
    expect(result.models.map((m) => m.model)).toEqual(BACKTEST_PLUS_MODEL_TYPES);
  });

  it("cada modelo processa todos os forwardDays", () => {
    const result = runBacktestPlus(baseConfig());
    for (const m of result.models) {
      expect(m.days.map((d) => d.date)).toEqual(["2026-01-05", "2026-01-06", "2026-01-07"]);
      for (const d of m.days) expect(d.entries).toHaveLength(5);
    }
  });

  it("é reprodutível: o mesmo seed + mesma config produz exatamente o mesmo resultado (reabrir o backtest não muda nada)", () => {
    const a = runBacktestPlus(baseConfig());
    const b = runBacktestPlus(baseConfig());
    const summarize = (r: typeof a) =>
      r.models.map((m) => ({
        model: m.model,
        selections: m.days.map((d) => d.entries.map((e) => e.candidateId)),
        metrics: m.metrics,
      }));
    expect(summarize(a)).toEqual(summarize(b));
  });

  it("não muta o pool recebido (imutabilidade do snapshot)", () => {
    const config = baseConfig();
    const originalPool = JSON.parse(JSON.stringify(config.pool));
    runBacktestPlus(config);
    expect(config.pool).toEqual(originalPool);
  });

  it("nunca processa dias fora de forwardDays, mesmo se houver candles disponíveis para outros dias (sem look-ahead além do escopo pedido)", () => {
    const config = baseConfig();
    // adiciona candles de um dia MUITO à frente, fora de forwardDays — não deve aparecer no resultado
    config.candles = [...config.candles, ...candlesForDays(["2026-02-01"], config.pool)];
    const result = runBacktestPlus(config);
    for (const m of result.models) {
      expect(m.days.map((d) => d.date)).not.toContain("2026-02-01");
    }
  });

  it("marca INVALID (no_data) quando falta candle para o dia, sem virar LOSS", () => {
    const config = baseConfig();
    config.candles = []; // nenhuma candle carregada
    const result = runBacktestPlus(config);
    for (const m of result.models) {
      for (const d of m.days) {
        for (const e of d.entries) {
          expect(e.result).toBe("invalid");
          expect(e.invalidReason).toBe("no_data");
        }
      }
      expect(m.metrics.invalidEntries).toBe(15); // 3 dias x 5 entradas
      expect(m.metrics.daysConsidered).toBe(0);
    }
  });

  it("TOP_SCORE é sempre o mesmo (grupo de controle), independente do seed", () => {
    const a = runBacktestPlus(baseConfig({ randomSeed: 1 }));
    const b = runBacktestPlus(baseConfig({ randomSeed: 2 }));
    const topScoreA = a.models.find((m) => m.model === "top_score")!;
    const topScoreB = b.models.find((m) => m.model === "top_score")!;
    expect(topScoreA.days).toEqual(topScoreB.days);
  });
});

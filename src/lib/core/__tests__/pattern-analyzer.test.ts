import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { Direction, DojiPolicy, makeCandle } from "../candle-classifier";
import {
  analyzeTimeSlot,
  rankPatterns,
  PatternStatus,
  DEFAULT_STATUS_THRESHOLDS,
} from "../pattern-analyzer";

function candle(
  dayOffset: number,
  openPrice: string,
  closePrice: string,
  hourUtc = 12,
  symbol = "EUR/USD",
  timeframe = "5m"
) {
  const t0 = new Date(Date.UTC(2026, 0, 1 + dayOffset, hourUtc, 0));
  const t1 = new Date(t0.getTime() + 5 * 60 * 1000);
  return makeCandle({
    symbol,
    timeframe,
    openTime: t0,
    closeTime: t1,
    open: openPrice,
    high: openPrice,
    low: closePrice,
    close: closePrice,
    volume: null,
    source: "test",
  });
}

describe("analyzeTimeSlot", () => {
  it("agrupa o mesmo horário em dias diferentes (exemplo do enunciado: 30 dias, 24 PUT, 6 CALL)", () => {
    const candles = [];
    for (let day = 0; day < 30; day++) {
      candles.push(day < 24 ? candle(day, "1.1010", "1.1000") : candle(day, "1.1000", "1.1010"));
    }
    const result = analyzeTimeSlot({
      candles,
      symbol: "EUR/USD",
      timeframe: "5m",
      targetTime: { hour: 12, minute: 0 },
      timezone: "UTC",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
    });

    expect(result.totalDaysAnalyzed).toBe(30);
    expect(result.putCount).toBe(24);
    expect(result.callCount).toBe(6);
    expect(result.predominantDirection).toBe(Direction.PUT);
    expect(result.repetitionPct.toNumber()).toBe(80);
  });

  it("não mistura horários diferentes", () => {
    const candles = [candle(0, "1.10", "1.11", 12), candle(0, "1.11", "1.10", 13)];
    const result = analyzeTimeSlot({
      candles,
      symbol: "EUR/USD",
      timeframe: "5m",
      targetTime: { hour: 12, minute: 0 },
      timezone: "UTC",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
    });
    expect(result.totalDaysAnalyzed).toBe(1);
    expect(result.callCount).toBe(1);
    expect(result.putCount).toBe(0);
  });

  it("converte timezone corretamente antes de agrupar", () => {
    const candles = Array.from({ length: 5 }, (_, day) => candle(day, "1.10", "1.11", 12));

    const resultSP = analyzeTimeSlot({
      candles,
      symbol: "EUR/USD",
      timeframe: "5m",
      targetTime: { hour: 9, minute: 0 }, // 12:00 UTC == 09:00 America/Sao_Paulo (sem DST em jan/2026)
      timezone: "America/Sao_Paulo",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
    });
    expect(resultSP.totalDaysAnalyzed).toBe(5);
    expect(resultSP.callCount).toBe(5);

    const resultWrong = analyzeTimeSlot({
      candles,
      symbol: "EUR/USD",
      timeframe: "5m",
      targetTime: { hour: 12, minute: 0 },
      timezone: "America/Sao_Paulo",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
    });
    expect(resultWrong.totalDaysAnalyzed).toBe(0);
  });

  it("filtra por dia da semana", () => {
    const candles = Array.from({ length: 14 }, (_, day) => candle(day, "1.10", "1.11"));
    const resultAll = analyzeTimeSlot({
      candles,
      symbol: "EUR/USD",
      timeframe: "5m",
      targetTime: { hour: 12, minute: 0 },
      timezone: "UTC",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
    });
    const resultWeekdays = analyzeTimeSlot({
      candles,
      symbol: "EUR/USD",
      timeframe: "5m",
      targetTime: { hour: 12, minute: 0 },
      timezone: "UTC",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
      weekdays: new Set([1, 2, 3, 4, 5]), // luxon: seg-sex
    });
    expect(resultWeekdays.totalDaysAnalyzed).toBeLessThan(resultAll.totalDaysAnalyzed);
  });

  it("marca amostra insuficiente com poucos dias", () => {
    const candles = Array.from({ length: 3 }, (_, day) => candle(day, "1.10", "1.11"));
    const result = analyzeTimeSlot({
      candles,
      symbol: "EUR/USD",
      timeframe: "5m",
      targetTime: { hour: 12, minute: 0 },
      timezone: "UTC",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
      thresholds: { ...DEFAULT_STATUS_THRESHOLDS, minValidOccurrences: 20 },
    });
    expect(result.status).toBe(PatternStatus.INSUFFICIENT_SAMPLE);
  });

  it("marca padrão forte e ativo quando geral e recente são altos", () => {
    const candles = [];
    for (let day = 0; day < 30; day++) {
      candles.push(day === 5 || day === 15 ? candle(day, "1.11", "1.10") : candle(day, "1.10", "1.11"));
    }
    const result = analyzeTimeSlot({
      candles,
      symbol: "EUR/USD",
      timeframe: "5m",
      targetTime: { hour: 12, minute: 0 },
      timezone: "UTC",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
      thresholds: { ...DEFAULT_STATUS_THRESHOLDS, minValidOccurrences: 20 },
    });
    expect(result.status).toBe(PatternStatus.STRONG_ACTIVE);
  });

  it("marca perdendo força quando o recente diverge do geral", () => {
    const candles = [];
    for (let day = 0; day < 30; day++) {
      candles.push(day < 20 ? candle(day, "1.10", "1.11") : candle(day, "1.11", "1.10"));
    }
    const result = analyzeTimeSlot({
      candles,
      symbol: "EUR/USD",
      timeframe: "5m",
      targetTime: { hour: 12, minute: 0 },
      timezone: "UTC",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
      thresholds: { ...DEFAULT_STATUS_THRESHOLDS, minValidOccurrences: 20 },
    });
    expect(result.predominantDirection).toBe(Direction.CALL);
    expect([PatternStatus.WEAKENING, PatternStatus.INACTIVE]).toContain(result.status);
  });
});

describe("rankPatterns", () => {
  it("ordena por repetitionPct desc", () => {
    const candlesA = Array.from({ length: 25 }, (_, d) => candle(d, "1.10", "1.11", 12, "A"));
    const r1 = analyzeTimeSlot({
      candles: candlesA,
      symbol: "A",
      timeframe: "5m",
      targetTime: { hour: 12, minute: 0 },
      timezone: "UTC",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
    });

    const candlesB = [
      ...Array.from({ length: 15 }, (_, d) => candle(d, "1.10", "1.11", 12, "B")),
      ...Array.from({ length: 10 }, (_, i) => candle(15 + i, "1.11", "1.10", 12, "B")),
    ];
    const r2 = analyzeTimeSlot({
      candles: candlesB,
      symbol: "B",
      timeframe: "5m",
      targetTime: { hour: 12, minute: 0 },
      timezone: "UTC",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
    });

    const ranked = rankPatterns([r2, r1], { sortBy: "repetitionPct" });
    expect(ranked[0].symbol).toBe("A");
  });

  it("filtra por percentual mínimo", () => {
    const candlesLow = [
      ...Array.from({ length: 10 }, (_, d) => candle(d, "1.10", "1.11", 12, "LOW")),
      ...Array.from({ length: 10 }, (_, i) => candle(10 + i, "1.11", "1.10", 12, "LOW")),
    ];
    const rLow = analyzeTimeSlot({
      candles: candlesLow,
      symbol: "LOW",
      timeframe: "5m",
      targetTime: { hour: 12, minute: 0 },
      timezone: "UTC",
      dojiTolerancePct: new Decimal(0),
      dojiPolicy: DojiPolicy.IGNORE,
    });
    const ranked = rankPatterns([rLow], { minPct: new Decimal(90) });
    expect(ranked).toEqual([]);
  });

  it("limita ao topN melhores após ordenar, dentro de um mesmo símbolo", () => {
    const symbol = "EURUSD";
    const results = [12, 13, 14, 15].map((hour, i) => {
      // hour=12 → 100%, 13 → 90%, 14 → 80%, 15 → 70% de repetição (10 dias cada)
      const callDays = 10 - i;
      const candles = [
        ...Array.from({ length: callDays }, (_, d) => candle(d, "1.10", "1.11", hour, symbol)),
        ...Array.from({ length: 10 - callDays }, (_, i2) =>
          candle(callDays + i2, "1.11", "1.10", hour, symbol)
        ),
      ];
      return analyzeTimeSlot({
        candles,
        symbol,
        timeframe: "5m",
        targetTime: { hour, minute: 0 },
        timezone: "UTC",
        dojiTolerancePct: new Decimal(0),
        dojiPolicy: DojiPolicy.IGNORE,
      });
    });

    const ranked = rankPatterns(results, { topN: 2 });
    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.timeOfDay)).toEqual([
      { hour: 12, minute: 0 },
      { hour: 13, minute: 0 },
    ]);
  });

  it("aplica o topN por símbolo, não globalmente, quando há múltiplos pares", () => {
    // Símbolo A tem os dois melhores percentuais globais; B tem os dois piores.
    // topN=2 deve manter os 2 melhores de CADA símbolo, não só os 2 melhores no total.
    const results = [
      { symbol: "A", hour: 12, callDays: 10 },
      { symbol: "A", hour: 13, callDays: 9 },
      { symbol: "B", hour: 12, callDays: 6 },
      { symbol: "B", hour: 13, callDays: 5 },
    ].map(({ symbol, hour, callDays }) => {
      const candles = [
        ...Array.from({ length: callDays }, (_, d) => candle(d, "1.10", "1.11", hour, symbol)),
        ...Array.from({ length: 10 - callDays }, (_, i2) =>
          candle(callDays + i2, "1.11", "1.10", hour, symbol)
        ),
      ];
      return analyzeTimeSlot({
        candles,
        symbol,
        timeframe: "5m",
        targetTime: { hour, minute: 0 },
        timezone: "UTC",
        dojiTolerancePct: new Decimal(0),
        dojiPolicy: DojiPolicy.IGNORE,
      });
    });

    const ranked = rankPatterns(results, { topN: 2 });
    expect(ranked).toHaveLength(4);
    expect(ranked.filter((r) => r.symbol === "A")).toHaveLength(2);
    expect(ranked.filter((r) => r.symbol === "B")).toHaveLength(2);
  });
});

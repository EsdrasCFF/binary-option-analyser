import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { Candle, Direction, DojiPolicy, makeCandle } from "@/lib/core/candle-classifier";
import { PatternStatus } from "@/lib/core/pattern-analyzer";
import { AnalysisRunConfig, formatTimeOfDay, runAnalysis } from "../run-analysis";

const BASE_CONFIG: AnalysisRunConfig = {
  timeframe: "5m",
  timezone: "UTC",
  dojiTolerancePct: new Decimal(0),
  dojiPolicy: DojiPolicy.IGNORE,
  minRepetitionPct: new Decimal(0),
  minValidDays: 20,
};

/** Cria um candle de 5m no dia/horário informados (UTC), na direção pedida. */
function candleAt(
  day: string,
  hhmm: string,
  direction: Direction,
  symbol = "EUR/USD"
): Candle {
  const open = "1.10000";
  const close =
    direction === Direction.CALL ? "1.10100" : direction === Direction.PUT ? "1.09900" : open;
  const openTime = new Date(`${day}T${hhmm}:00Z`);
  const closeTime = new Date(openTime.getTime() + 5 * 60 * 1000);
  return makeCandle({
    symbol,
    timeframe: "5m",
    openTime,
    closeTime,
    open,
    high: "1.10200",
    low: "1.09800",
    close,
    volume: "1000",
    source: "test",
  });
}

/** Dias consecutivos a partir de 2026-01-01 (quinta-feira). */
function days(count: number, startDay = 1): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, startDay + i));
    return d.toISOString().slice(0, 10);
  });
}

describe("runAnalysis", () => {
  it("reproduz o exemplo do enunciado: 30 dias, 24 PUT, 6 CALL = 80%", () => {
    // CALL nos índices 0,5,10,15,20,25 (6 dias); PUT nos demais (24 dias).
    const candles = days(30).map((day, i) =>
      candleAt(day, "12:00", i % 5 === 0 ? Direction.CALL : Direction.PUT)
    );

    const results = runAnalysis(candles, BASE_CONFIG);

    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result.symbol).toBe("EUR/USD");
    expect(formatTimeOfDay(result.timeOfDay)).toBe("12:00");
    expect(result.totalDaysAnalyzed).toBe(30);
    expect(result.totalValid).toBe(30);
    expect(result.putCount).toBe(24);
    expect(result.callCount).toBe(6);
    expect(result.predominantDirection).toBe(Direction.PUT);
    expect(result.repetitionPct.toFixed(2)).toBe("80.00");
    // últimos 10 dias: CALL nos índices 20 e 25 -> 8 de 10 PUT
    expect(result.recent10Pct?.toFixed(2)).toBe("80.00");
    expect(result.status).toBe(PatternStatus.STRONG_ACTIVE);
  });

  it("analisa apenas os horários existentes, um resultado por horário", () => {
    const candles = days(25).flatMap((day) => [
      candleAt(day, "08:00", Direction.CALL),
      candleAt(day, "12:00", Direction.PUT),
    ]);

    const results = runAnalysis(candles, BASE_CONFIG);
    const horarios = results.map((r) => formatTimeOfDay(r.timeOfDay)).sort();
    expect(horarios).toEqual(["08:00", "12:00"]);
  });

  it("respeita a janela de horários configurada", () => {
    const candles = days(25).flatMap((day) => [
      candleAt(day, "08:00", Direction.CALL),
      candleAt(day, "12:00", Direction.PUT),
      candleAt(day, "18:00", Direction.CALL),
    ]);

    const results = runAnalysis(candles, {
      ...BASE_CONFIG,
      startTime: "10:00",
      endTime: "13:00",
    });

    expect(results).toHaveLength(1);
    expect(formatTimeOfDay(results[0].timeOfDay)).toBe("12:00");
  });

  it("aceita janela que atravessa a meia-noite (ex: 22:00 -> 02:00)", () => {
    const candles = days(25).flatMap((day) => [
      candleAt(day, "01:00", Direction.PUT),
      candleAt(day, "12:00", Direction.CALL),
      candleAt(day, "22:00", Direction.PUT),
    ]);

    const results = runAnalysis(candles, {
      ...BASE_CONFIG,
      startTime: "22:00",
      endTime: "02:00",
    });

    const horarios = results.map((r) => formatTimeOfDay(r.timeOfDay)).sort();
    expect(horarios).toEqual(["01:00", "22:00"]);
  });

  it("agrupa pelo horário local do timezone da análise, não em UTC", () => {
    const candles = days(25).map((day) => candleAt(day, "12:00", Direction.PUT));

    const results = runAnalysis(candles, {
      ...BASE_CONFIG,
      timezone: "America/Sao_Paulo", // UTC-3
    });

    expect(results).toHaveLength(1);
    expect(formatTimeOfDay(results[0].timeOfDay)).toBe("09:00");
    expect(results[0].timezone).toBe("America/Sao_Paulo");
  });

  it("filtra por dias da semana (padrão luxon: 1 = segunda-feira)", () => {
    const candles = days(14).map((day) => candleAt(day, "12:00", Direction.PUT));

    const results = runAnalysis(candles, {
      ...BASE_CONFIG,
      weekdays: [1],
      minValidDays: 1,
    });

    expect(results).toHaveLength(1);
    // entre 2026-01-01 (quinta) e 2026-01-14 há duas segundas-feiras
    expect(results[0].totalDaysAnalyzed).toBe(2);
  });

  it("descarta padrões abaixo do percentual mínimo de repetição", () => {
    const candles = days(30).flatMap((day, i) => [
      // 12:00 -> 80% PUT
      candleAt(day, "12:00", i % 5 === 0 ? Direction.CALL : Direction.PUT),
      // 13:00 -> 50% (alterna)
      candleAt(day, "13:00", i % 2 === 0 ? Direction.CALL : Direction.PUT),
    ]);

    const semFiltro = runAnalysis(candles, BASE_CONFIG);
    expect(semFiltro).toHaveLength(2);

    const comFiltro = runAnalysis(candles, {
      ...BASE_CONFIG,
      minRepetitionPct: new Decimal(70),
    });
    expect(comFiltro).toHaveLength(1);
    expect(formatTimeOfDay(comFiltro[0].timeOfDay)).toBe("12:00");
  });

  it("separa resultados por par de moedas", () => {
    const candles = days(25).flatMap((day) => [
      candleAt(day, "12:00", Direction.PUT, "EUR/USD"),
      candleAt(day, "12:00", Direction.CALL, "GBP/USD"),
    ]);

    const results = runAnalysis(candles, BASE_CONFIG);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.symbol).sort()).toEqual(["EUR/USD", "GBP/USD"]);
  });

  it("ignora candles de outro timeframe", () => {
    const candles = days(25).map((day) => candleAt(day, "12:00", Direction.PUT));
    const results = runAnalysis(candles, { ...BASE_CONFIG, timeframe: "15m" });
    expect(results).toHaveLength(0);
  });

  it("ordena o resultado pelo percentual de repetição (maior primeiro)", () => {
    const candles = days(30).flatMap((day, i) => [
      candleAt(day, "12:00", i % 5 === 0 ? Direction.CALL : Direction.PUT), // 80%
      candleAt(day, "13:00", i % 3 === 0 ? Direction.CALL : Direction.PUT), // 66,67%
    ]);

    const results = runAnalysis(candles, BASE_CONFIG);
    expect(results.map((r) => formatTimeOfDay(r.timeOfDay))).toEqual(["12:00", "13:00"]);
  });

  it("mantém só os topN melhores horários (caso de uso: ranking de até 10 horários)", () => {
    // 5 horários com percentuais diferentes: 12:00=100%, 13:00=90%, 14:00=80%, 15:00=70%, 16:00=60%
    const candles = days(30).flatMap((day, i) => [
      candleAt(day, "12:00", Direction.PUT),
      candleAt(day, "13:00", i < 27 ? Direction.PUT : Direction.CALL),
      candleAt(day, "14:00", i < 24 ? Direction.PUT : Direction.CALL),
      candleAt(day, "15:00", i < 21 ? Direction.PUT : Direction.CALL),
      candleAt(day, "16:00", i < 18 ? Direction.PUT : Direction.CALL),
    ]);

    const results = runAnalysis(candles, { ...BASE_CONFIG, topN: 3 });
    expect(results).toHaveLength(3);
    expect(results.map((r) => formatTimeOfDay(r.timeOfDay))).toEqual(["12:00", "13:00", "14:00"]);
  });
});

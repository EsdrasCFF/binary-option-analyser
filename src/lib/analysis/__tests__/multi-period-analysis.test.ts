import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { Direction, DojiPolicy, makeCandle } from "@/lib/core/candle-classifier";
import {
  analyzeMultiPeriod,
  buildStructuralWindowDays,
  isValidMaxDays,
  resolveMaxDaysFromDateRange,
  selectTopPatterns,
} from "../multi-period-analysis";

function candle(dayOffset: number, up: boolean, symbol = "AUD/CAD", hourUtc = 14) {
  const t0 = new Date(Date.UTC(2026, 0, 1 + dayOffset, hourUtc, 0));
  const t1 = new Date(t0.getTime() + 5 * 60 * 1000);
  return makeCandle({
    symbol,
    timeframe: "5m",
    openTime: t0,
    closeTime: t1,
    open: "1.1000",
    high: "1.1000",
    low: "1.1000",
    close: up ? "1.1010" : "1.0990",
    volume: null,
    source: "test",
  });
}

/** Data de referência correspondente ao dayOffset informado (dayOffset 0 = 01/jan/2026). */
function referenceDateForDay(dayOffset: number): Date {
  return new Date(Date.UTC(2026, 0, 1 + dayOffset));
}

const BASE_CONFIG = {
  timeframe: "5m",
  timezone: "UTC",
  dojiTolerancePct: new Decimal(0),
  dojiPolicy: DojiPolicy.IGNORE,
  persistenceThresholdPct: new Decimal(70),
};

describe("buildStructuralWindowDays (seção 1)", () => {
  it("60 dias -> [60, 50]", () => {
    expect(buildStructuralWindowDays(60, 50)).toEqual([60, 50]);
  });
  it("70 dias -> [70, 60, 50]", () => {
    expect(buildStructuralWindowDays(70, 50)).toEqual([70, 60, 50]);
  });
  it("100 dias -> [100,90,80,70,60,50]", () => {
    expect(buildStructuralWindowDays(100, 50)).toEqual([100, 90, 80, 70, 60, 50]);
  });
  it("150 dias -> 11 janelas de 150 até 50", () => {
    expect(buildStructuralWindowDays(150, 50)).toEqual([150, 140, 130, 120, 110, 100, 90, 80, 70, 60, 50]);
  });
});

describe("resolveMaxDaysFromDateRange (modo \"período específico\")", () => {
  it("arredonda pra baixo até o múltiplo de 10 mais próximo — nunca pra cima", () => {
    const start = new Date(Date.UTC(2026, 0, 1));
    // 73 dias de intervalo -> 70 (nunca 80, que exigiria mais dados do que o intervalo tem)
    const end = new Date(Date.UTC(2026, 0, 1 + 73));
    expect(resolveMaxDaysFromDateRange(start, end)).toBe(70);
  });

  it("intervalo exato de múltiplo de 10 fica igual", () => {
    const start = new Date(Date.UTC(2026, 0, 1));
    const end = new Date(Date.UTC(2026, 0, 1 + 100));
    expect(resolveMaxDaysFromDateRange(start, end)).toBe(100);
  });

  it("intervalo menor que a menor janela estrutural também é arredondado normalmente — quem rejeita é o chamador (validando contra minStructuralDays)", () => {
    const start = new Date(Date.UTC(2026, 0, 1));
    const end = new Date(Date.UTC(2026, 0, 1 + 30));
    expect(resolveMaxDaysFromDateRange(start, end)).toBe(30);
    expect(isValidMaxDays(30, 50)).toBe(false);
  });
});

describe("isValidMaxDays", () => {
  it("aceita múltiplos de 10 >= 50", () => {
    expect(isValidMaxDays(50, 50)).toBe(true);
    expect(isValidMaxDays(200, 50)).toBe(true);
  });
  it("rejeita abaixo do mínimo estrutural ou não-múltiplo de 10", () => {
    expect(isValidMaxDays(40, 50)).toBe(false);
    expect(isValidMaxDays(65, 50)).toBe(false);
  });
});

describe("analyzeMultiPeriod — descoberta e janelas encaixadas (seções 2, 18, 19)", () => {
  it("identifica um único padrão multi-período por PAR+HORÁRIO+DIREÇÃO, com uma linha por janela", () => {
    const candles = [];
    for (let day = 0; day < 100; day++) {
      // ~80% CALL ao longo de todo o período — padrão estável e forte
      candles.push(candle(day, day % 5 !== 0));
    }
    const results = analyzeMultiPeriod(candles, { ...BASE_CONFIG, maxDays: 70 }, referenceDateForDay(99));
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.symbol).toBe("AUD/CAD");
    expect(r.direction).toBe(Direction.CALL);
    expect(r.windows.map((w) => w.days)).toEqual([70, 60, 50]);
    expect(r.momentumWindow.days).toBe(40);
    expect(r.momentumWindow.isMomentum).toBe(true);
    // "dias válidos" pra exibição = ocorrências da MAIOR janela estrutural
    // (70D aqui), nunca a da janela de momentum (40D) nem o mínimo entre janelas.
    expect(r.totalValid).toBe(r.windows[0].validSamples);
    expect(r.windows[0].days).toBe(70);
    expect(r.totalValid).not.toBe(r.momentumWindow.validSamples);
    expect(r.windows.every((w) => !w.isMomentum)).toBe(true);
  });

  it("todas as janelas terminam na mesma data de referência — nunca usa candles depois dela (seções 18-19)", () => {
    const candles = [];
    for (let day = 0; day < 70; day++) candles.push(candle(day, true)); // 100% CALL até o dia 69
    // candles "do futuro" (depois da referência, dia 69) — se vazarem pro cálculo, mudariam a frequência
    for (let day = 90; day < 120; day++) candles.push(candle(day, false)); // PUT, mas isso é pós-referência

    const results = analyzeMultiPeriod(candles, { ...BASE_CONFIG, maxDays: 50 }, referenceDateForDay(69));
    const r = results[0];
    // se houvesse look-ahead, a frequência de CALL cairia — deve continuar em 100%
    expect(r.windows[0].frequency.toNumber()).toBe(100);
  });

  it("detecta persistência perfeita e gera score/recomendação coerentes", () => {
    const candles = [];
    for (let day = 0; day < 70; day++) candles.push(candle(day, true)); // 100% CALL, mas amostra vai ficar pequena por janela (1x/dia)
    const results = analyzeMultiPeriod(candles, { ...BASE_CONFIG, maxDays: 70 }, referenceDateForDay(69));
    const r = results[0];
    expect(r.persistence.confirmed).toBe(r.persistence.total);
    expect(r.recommendation).not.toBe("contra"); // nunca "contra" num padrão 100% consistente
  });

  it("detecta inversão quando a direção recente diverge fortemente do histórico (seção 11)", () => {
    const candles = [];
    // dias 0-59 (mais antigos): predominantemente CALL: constrói o histórico "estrutural" alto em CALL
    for (let day = 0; day < 60; day++) candles.push(candle(day, day % 10 !== 0)); // ~90% CALL
    // dias 60-99 (os 40 dias mais recentes = janela de momentum): predominantemente PUT
    for (let day = 60; day < 100; day++) candles.push(candle(day, day % 10 === 0)); // ~90% PUT

    const results = analyzeMultiPeriod(candles, { ...BASE_CONFIG, maxDays: 100 }, referenceDateForDay(99));
    const r = results[0];
    // direção histórica (janela máxima, 100D) ainda é CALL (mais dias antigos com CALL alto que recentes com PUT)
    expect(r.direction).toBe(Direction.CALL);
    expect(["possible", "confirmed"]).toContain(r.inversion);
    expect(r.momentumTrend).toBe("possivel_inversao");
    // nunca recomenda contra sem confirmação
    if (r.inversion === "possible") expect(r.recommendation).toBe("observar");
    if (r.inversion === "confirmed") expect(r.recommendation).toBe("contra");
  });

  it("maxDays inválido lança erro claro", () => {
    expect(() => analyzeMultiPeriod([], { ...BASE_CONFIG, maxDays: 45 }, referenceDateForDay(0))).toThrow(/maxDays/);
  });
});

describe("selectTopPatterns (seção 13)", () => {
  it("ordena por confidenceScore desc, não pelo maior percentual bruto", () => {
    const results = [
      { confidenceScore: 60, persistence: { percentage: new Decimal(50) }, stability: { range: new Decimal(10) }, sampleMin: 20, structuralAverage: new Decimal(95) },
      { confidenceScore: 90, persistence: { percentage: new Decimal(100) }, stability: { range: new Decimal(2) }, sampleMin: 50, structuralAverage: new Decimal(81) },
    ] as any;
    const top = selectTopPatterns(results, 5);
    expect(top[0].confidenceScore).toBe(90);
  });

  it("desempata por persistência, depois estabilidade, depois amostra", () => {
    const results = [
      { confidenceScore: 90, persistence: { percentage: new Decimal(66) }, stability: { range: new Decimal(5) }, sampleMin: 30, structuralAverage: new Decimal(80) },
      { confidenceScore: 90, persistence: { percentage: new Decimal(100) }, stability: { range: new Decimal(2) }, sampleMin: 50, structuralAverage: new Decimal(80) },
    ] as any;
    const top = selectTopPatterns(results, 5);
    expect(top[0].persistence.percentage.toNumber()).toBe(100);
  });
});

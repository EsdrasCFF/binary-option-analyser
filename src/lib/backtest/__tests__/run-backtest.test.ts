import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { Candle, Direction, DojiPolicy, makeCandle } from "@/lib/core/candle-classifier";
import { calculateMode1 } from "@/lib/core/martingale-calculator";
import { BacktestRunConfig, BacktestTarget, runBacktest } from "../run-backtest";

const SYMBOL = "EUR/USD";
const TIMEFRAME = "5m";

function candleAt(day: string, hhmm: string, direction: Direction, symbol = SYMBOL): Candle {
  const open = "1.10000";
  const close =
    direction === Direction.CALL ? "1.10100" : direction === Direction.PUT ? "1.09900" : open;
  const openTime = new Date(`${day}T${hhmm}:00Z`);
  const closeTime = new Date(openTime.getTime() + 5 * 60 * 1000);
  return makeCandle({
    symbol,
    timeframe: TIMEFRAME,
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

/** Candle contíguo ao anterior (mesmo horário de abertura = fechamento do anterior) — para simular a perseguição do Martingale. */
function nextCandle(prev: Candle, direction: Direction): Candle {
  const open = "1.10000";
  const close =
    direction === Direction.CALL ? "1.10100" : direction === Direction.PUT ? "1.09900" : open;
  return makeCandle({
    symbol: prev.symbol,
    timeframe: prev.timeframe,
    openTime: prev.closeTime,
    closeTime: new Date(prev.closeTime.getTime() + 5 * 60 * 1000),
    open,
    high: "1.10200",
    low: "1.09800",
    close,
    volume: "1000",
    source: "test",
  });
}

function days(count: number, startDay = 1): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, startDay + i));
    return d.toISOString().slice(0, 10);
  });
}

function target(overrides: Partial<BacktestTarget> = {}): BacktestTarget {
  return {
    currencyPairId: "pair-1",
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    timeOfDay: { hour: 12, minute: 0 },
    timezone: "UTC",
    dojiTolerancePct: new Decimal(0),
    minValidDays: 5,
    ...overrides,
  };
}

function config(overrides: Partial<BacktestRunConfig> = {}): BacktestRunConfig {
  return {
    entryStrategy: "same_direction",
    payoutPct: new Decimal(85),
    initialBankroll: new Decimal(1000),
    initialEntry: new Decimal(5),
    minProfit: new Decimal(1),
    martingaleLevels: 2,
    dojiPolicy: DojiPolicy.IGNORE,
    oneEntryPerTimeSlot: true,
    periodStart: new Date("2026-01-01T00:00:00Z"),
    periodEnd: new Date("2026-12-31T23:59:59Z"),
    ...overrides,
  };
}

describe("runBacktest", () => {
  it("nunca olha o futuro: usa só os dias anteriores para prever, mesmo que o período inteiro diga outra coisa", () => {
    // histórico (antes do backtest): 20 dias, todos PUT às 12:00
    const history = days(20, 1).map((d) => candleAt(d, "12:00", Direction.PUT));
    // período do backtest: 5 dias, todos CALL — o oposto do histórico
    const liveDays = days(5, 21);
    const live = liveDays.map((d) => candleAt(d, "12:00", Direction.CALL));

    const result = runBacktest([...history, ...live], [target({ minValidDays: 15 })], {
      ...config(),
      martingaleLevels: 0, // sem continuação de candles nesse teste: cada dia resolve num único candle
      periodStart: new Date(`${liveDays[0]}T00:00:00Z`),
      periodEnd: new Date(`${liveDays[liveDays.length - 1]}T23:59:59Z`),
    });

    expect(result.operations).toHaveLength(5);
    // previu PUT (único dado disponível até então) mas o real foi CALL: perde toda vez
    for (const op of result.operations) {
      expect(op.entryDirection).toBe(Direction.PUT);
      expect(op.actualDirection).toBe(Direction.CALL);
      expect(op.result).toBe("loss");
    }
  });

  it("vitória no nível 0: lucro bate com martingale-calculator", () => {
    const history = days(10, 1).map((d) => candleAt(d, "12:00", Direction.PUT));
    const liveDays = days(1, 11);
    const live = [candleAt(liveDays[0], "12:00", Direction.PUT)]; // acerta a previsão

    const cfg = config({
      periodStart: new Date(`${liveDays[0]}T00:00:00Z`),
      periodEnd: new Date(`${liveDays[0]}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], [target()], cfg);

    expect(result.operations).toHaveLength(1);
    const [op] = result.operations;
    expect(op.result).toBe("win");
    expect(op.martingaleLevelReached).toBe(0);

    const expected = calculateMode1({
      bankroll: cfg.initialBankroll,
      payoutPct: cfg.payoutPct,
      initialEntry: cfg.initialEntry,
      minProfit: cfg.minProfit,
      martingaleLevels: cfg.martingaleLevels,
    });
    expect(op.profitLoss.toFixed(2)).toBe(expected.levels[0].netProfitAfterRecovery.toFixed(2));
    expect(op.bankrollAfter.toFixed(2)).toBe(
      cfg.initialBankroll.plus(expected.levels[0].netProfitAfterRecovery).toFixed(2)
    );
  });

  it("persegue a perda no candle seguinte (não no dia seguinte) e vence no nível 1", () => {
    const history = days(10, 1).map((d) => candleAt(d, "12:00", Direction.PUT));
    const liveDay = days(1, 11)[0];
    const lossCandle = candleAt(liveDay, "12:00", Direction.CALL); // previu PUT, veio CALL: perde
    const winCandle = nextCandle(lossCandle, Direction.PUT); // candle seguinte, mesma série: acerta

    const cfg = config({
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, lossCandle, winCandle], [target()], cfg);

    expect(result.operations).toHaveLength(1);
    const [op] = result.operations;
    expect(op.result).toBe("win");
    expect(op.martingaleLevelReached).toBe(1);

    const expected = calculateMode1({
      bankroll: cfg.initialBankroll,
      payoutPct: cfg.payoutPct,
      initialEntry: cfg.initialEntry,
      minProfit: cfg.minProfit,
      martingaleLevels: cfg.martingaleLevels,
    });
    expect(op.profitLoss.toFixed(2)).toBe(expected.levels[1].netProfitAfterRecovery.toFixed(2));
  });

  it("esgota todos os níveis: derrota final com o valor total exposto", () => {
    const history = days(10, 1).map((d) => candleAt(d, "12:00", Direction.PUT));
    const liveDay = days(1, 11)[0];
    const l0 = candleAt(liveDay, "12:00", Direction.CALL);
    const l1 = nextCandle(l0, Direction.CALL);

    const cfg = config({
      martingaleLevels: 1,
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, l0, l1], [target()], cfg);

    expect(result.operations).toHaveLength(1);
    const [op] = result.operations;
    expect(op.result).toBe("loss");
    expect(op.martingaleLevelReached).toBe(1);

    const expected = calculateMode1({
      bankroll: cfg.initialBankroll,
      payoutPct: cfg.payoutPct,
      initialEntry: cfg.initialEntry,
      minProfit: cfg.minProfit,
      martingaleLevels: 1,
    });
    expect(op.profitLoss.neg().toFixed(2)).toBe(expected.levels[1].accumulatedExposure.toFixed(2));
    expect(op.bankrollAfter.toFixed(2)).toBe(
      cfg.initialBankroll.minus(expected.levels[1].accumulatedExposure).toFixed(2)
    );
  });

  it("não opera com amostra insuficiente (menos dias de histórico do que minValidDays)", () => {
    const history = days(3, 1).map((d) => candleAt(d, "12:00", Direction.PUT)); // só 3 dias
    const liveDay = days(1, 4)[0];
    const live = candleAt(liveDay, "12:00", Direction.PUT);

    const cfg = config({
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, live], [target({ minValidDays: 5 })], cfg);

    expect(result.operations).toHaveLength(0);
  });

  describe("política de DOJI no candle real", () => {
    const history = () => days(10, 1).map((d) => candleAt(d, "12:00", Direction.PUT));

    it("IGNORE: não conta como operação", () => {
      const liveDay = days(1, 11)[0];
      const doji = candleAt(liveDay, "12:00", Direction.DOJI);
      const cfg = config({
        dojiPolicy: DojiPolicy.IGNORE,
        periodStart: new Date(`${liveDay}T00:00:00Z`),
        periodEnd: new Date(`${liveDay}T23:59:59Z`),
      });
      const result = runBacktest([...history(), doji], [target()], cfg);
      expect(result.operations).toHaveLength(0);
    });

    it("COUNT_AS_TIE: conta como empate, sem alterar a banca", () => {
      const liveDay = days(1, 11)[0];
      const doji = candleAt(liveDay, "12:00", Direction.DOJI);
      const cfg = config({
        dojiPolicy: DojiPolicy.COUNT_AS_TIE,
        periodStart: new Date(`${liveDay}T00:00:00Z`),
        periodEnd: new Date(`${liveDay}T23:59:59Z`),
      });
      const result = runBacktest([...history(), doji], [target()], cfg);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].result).toBe("tie");
      expect(result.operations[0].profitLoss.toFixed(2)).toBe("0.00");
      expect(result.operations[0].bankrollAfter.toFixed(2)).toBe(cfg.initialBankroll.toFixed(2));
    });

    it("COUNT_AS_LOSS: derrota normal, pode acionar o Martingale", () => {
      const liveDay = days(1, 11)[0];
      const doji = candleAt(liveDay, "12:00", Direction.DOJI);
      const cfg = config({
        martingaleLevels: 0,
        dojiPolicy: DojiPolicy.COUNT_AS_LOSS,
        periodStart: new Date(`${liveDay}T00:00:00Z`),
        periodEnd: new Date(`${liveDay}T23:59:59Z`),
      });
      const result = runBacktest([...history(), doji], [target()], cfg);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].result).toBe("loss");
      expect(result.operations[0].profitLoss.toFixed(2)).toBe(cfg.initialEntry.neg().toFixed(2));
    });
  });

  it("entryStrategy contrarian aposta contra a direção predominante", () => {
    const history = days(10, 1).map((d) => candleAt(d, "12:00", Direction.PUT)); // predominante = PUT
    const liveDay = days(1, 11)[0];
    const live = candleAt(liveDay, "12:00", Direction.CALL); // contrário do predominante: acerta se for contrarian

    const cfg = config({
      entryStrategy: "contrarian",
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, live], [target()], cfg);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].entryDirection).toBe(Direction.CALL);
    expect(result.operations[0].result).toBe("win");
  });

  it("dailyLossLimit impede novas operações no mesmo dia após o limite ser atingido", () => {
    const history = days(10, 1).map((d) => [
      candleAt(d, "12:00", Direction.PUT),
      candleAt(d, "13:00", Direction.PUT),
    ]).flat();
    const liveDay = days(1, 11)[0];
    // ambos os horários erram a previsão (PUT previsto, CALL realizado) nesse dia
    const live = [candleAt(liveDay, "12:00", Direction.CALL), candleAt(liveDay, "13:00", Direction.CALL)];

    const targets = [
      target({ timeOfDay: { hour: 12, minute: 0 } }),
      target({ timeOfDay: { hour: 13, minute: 0 } }),
    ];
    const cfg = config({
      martingaleLevels: 0,
      dailyLossLimit: new Decimal(5), // exatamente a perda da 1a operação: bloqueia a 2a
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], targets, cfg);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].timeOfDay).toBe("12:00");
  });

  it("maxOperationsPerDay limita o total de operações abertas no dia", () => {
    const history = days(10, 1).map((d) => [
      candleAt(d, "12:00", Direction.PUT),
      candleAt(d, "13:00", Direction.PUT),
    ]).flat();
    const liveDay = days(1, 11)[0];
    const live = [candleAt(liveDay, "12:00", Direction.PUT), candleAt(liveDay, "13:00", Direction.PUT)];

    const targets = [
      target({ timeOfDay: { hour: 12, minute: 0 } }),
      target({ timeOfDay: { hour: 13, minute: 0 } }),
    ];
    const cfg = config({
      maxOperationsPerDay: 1,
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], targets, cfg);

    expect(result.operations).toHaveLength(1);
  });

  it("agrega métricas por par, horário, dia da semana e mês", () => {
    const history = days(10, 1).map((d) => candleAt(d, "12:00", Direction.PUT));
    const liveDays = days(2, 11);
    const live = [
      candleAt(liveDays[0], "12:00", Direction.PUT), // vitória
      candleAt(liveDays[1], "12:00", Direction.CALL), // derrota
    ];

    const cfg = config({
      martingaleLevels: 0,
      periodStart: new Date(`${liveDays[0]}T00:00:00Z`),
      periodEnd: new Date(`${liveDays[1]}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], [target()], cfg);

    expect(result.summary.totalOperations).toBe(2);
    expect(result.summary.wins).toBe(1);
    expect(result.summary.losses).toBe(1);
    expect(result.summary.byCurrencyPair[SYMBOL].operations).toBe(2);
    expect(result.summary.byTimeOfDay["12:00"].operations).toBe(2);
    expect(result.summary.profitFactor).not.toBeNull();
    expect(new Decimal(result.summary.maxDrawdown).gt(0)).toBe(true);
  });
});

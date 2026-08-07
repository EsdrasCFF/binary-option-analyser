import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { Candle, Direction, DojiPolicy, makeCandle } from "@/lib/core/candle-classifier";
import { calculateMode1 } from "@/lib/core/martingale-calculator";
import { BacktestRunConfig, runBacktest } from "../run-backtest";

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

function days(count: number, startDay = 1): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, startDay + i));
    return d.toISOString().slice(0, 10);
  });
}

function config(overrides: Partial<BacktestRunConfig> = {}): BacktestRunConfig {
  return {
    timeframe: TIMEFRAME,
    timezone: "UTC",
    dojiTolerancePct: new Decimal(0),
    minRepetitionPct: new Decimal(60),
    minValidDays: 15,
    slotCount: 3,
    entryStrategy: "same_direction",
    payoutPct: new Decimal(85),
    initialBankroll: new Decimal(1000),
    initialEntry: new Decimal(5),
    minProfit: new Decimal(1),
    dojiPolicy: DojiPolicy.IGNORE,
    periodStart: new Date("2026-01-01T00:00:00Z"),
    periodEnd: new Date("2026-01-01T23:59:59Z"),
    ...overrides,
  };
}

/** 20 dias de histórico com PUT em três horários, todos fortes o bastante pra passar no filtro padrão. */
function strongHistory(): Candle[] {
  return days(20, 1).flatMap((d) => [
    candleAt(d, "07:00", Direction.PUT),
    candleAt(d, "09:00", Direction.PUT),
    candleAt(d, "12:00", Direction.PUT),
  ]);
}

describe("runBacktest", () => {
  it("perde no primeiro horário da escada e vence no segundo (não é o mesmo horário do dia seguinte)", () => {
    const history = strongHistory();
    const liveDay = days(1, 21)[0];
    const live = [
      candleAt(liveDay, "07:00", Direction.CALL), // previa PUT: perde
      candleAt(liveDay, "09:00", Direction.PUT), // previa PUT: vence
      candleAt(liveDay, "12:00", Direction.CALL), // nem deveria ser tocado
    ];

    const cfg = config({
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);

    expect(result.operations).toHaveLength(1);
    const [op] = result.operations;
    expect(op.result).toBe("win");
    expect(op.martingaleLevelReached).toBe(1);
    expect(op.timeOfDay).toBe("09:00");

    const schedule = calculateMode1({
      bankroll: cfg.initialBankroll,
      payoutPct: cfg.payoutPct,
      initialEntry: cfg.initialEntry,
      minProfit: cfg.minProfit,
      martingaleLevels: 2, // slotCount(3) - 1
    });
    expect(op.profitLoss.toFixed(2)).toBe(schedule.levels[1].netProfitAfterRecovery.toFixed(2));
  });

  it("a escada é ordenada por horário, não pela força do ranking", () => {
    // 12:00 é o mais forte (100%), mas é o ÚLTIMO da escada por ser o horário mais tarde
    const history = days(20, 1).flatMap((d, i) => [
      candleAt(d, "07:00", i < 18 ? Direction.PUT : Direction.CALL), // 90%
      candleAt(d, "09:00", i < 16 ? Direction.PUT : Direction.CALL), // 80%
      candleAt(d, "12:00", Direction.PUT), // 100%
    ]);
    const liveDay = days(1, 21)[0];
    const live = [
      candleAt(liveDay, "07:00", Direction.CALL), // nível 0: perde
      candleAt(liveDay, "09:00", Direction.CALL), // nível 1: perde
      candleAt(liveDay, "12:00", Direction.PUT), // nível 2: vence
    ];

    const cfg = config({
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].timeOfDay).toBe("12:00");
    expect(result.operations[0].martingaleLevelReached).toBe(2);
    expect(result.operations[0].result).toBe("win");
  });

  it("esgota a escada do dia: derrota final com a exposição total", () => {
    const history = strongHistory();
    const liveDay = days(1, 21)[0];
    const live = [
      candleAt(liveDay, "07:00", Direction.CALL),
      candleAt(liveDay, "09:00", Direction.CALL),
      candleAt(liveDay, "12:00", Direction.CALL),
    ];

    const cfg = config({
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);

    expect(result.operations).toHaveLength(1);
    const [op] = result.operations;
    expect(op.result).toBe("loss");
    expect(op.martingaleLevelReached).toBe(2);

    const schedule = calculateMode1({
      bankroll: cfg.initialBankroll,
      payoutPct: cfg.payoutPct,
      initialEntry: cfg.initialEntry,
      minProfit: cfg.minProfit,
      martingaleLevels: 2,
    });
    expect(op.profitLoss.neg().toFixed(2)).toBe(schedule.levels[2].accumulatedExposure.toFixed(2));
  });

  it("usa menos níveis quando nem todos os horários selecionados são elegíveis naquele dia", () => {
    // 07:00 e 09:00 têm histórico forte; 12:00 só existe há 3 dias (não passa minValidDays=15)
    const history = [
      ...days(20, 1).flatMap((d) => [candleAt(d, "07:00", Direction.PUT), candleAt(d, "09:00", Direction.PUT)]),
      ...days(3, 18).map((d) => candleAt(d, "12:00", Direction.PUT)),
    ];
    const liveDay = days(1, 21)[0];
    const live = [candleAt(liveDay, "07:00", Direction.CALL), candleAt(liveDay, "09:00", Direction.PUT)];

    const cfg = config({
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].martingaleLevelReached).toBe(1); // só 2 horários elegíveis: níveis 0 e 1
    expect(result.operations[0].timeOfDay).toBe("09:00");
  });

  it("não opera no dia se nenhum horário for elegível ainda", () => {
    const history = days(3, 1).flatMap((d) => [candleAt(d, "07:00", Direction.PUT)]); // só 3 dias, minValidDays=15
    const liveDay = days(1, 4)[0];
    const live = [candleAt(liveDay, "07:00", Direction.PUT)];

    const cfg = config({
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);
    expect(result.operations).toHaveLength(0);
  });

  it("descarta o dia inteiro se faltar o candle de algum horário da escada (gap de dados)", () => {
    const history = strongHistory();
    const liveDay = days(1, 21)[0];
    // só o candle de 07:00 existe nesse dia; 09:00 e 12:00 faltam (gap)
    const live = [candleAt(liveDay, "07:00", Direction.CALL)];

    const cfg = config({
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);
    expect(result.operations).toHaveLength(0);
  });

  describe("política de DOJI no candle que resolveria a operação", () => {
    function historyAndConfig() {
      const history = days(20, 1).map((d) => candleAt(d, "07:00", Direction.PUT));
      const liveDay = days(1, 21)[0];
      return {
        history,
        liveDay,
        cfg: config({
          slotCount: 1,
          periodStart: new Date(`${liveDay}T00:00:00Z`),
          periodEnd: new Date(`${liveDay}T23:59:59Z`),
        }),
      };
    }

    it("IGNORE: não conta como operação", () => {
      const { history, liveDay, cfg } = historyAndConfig();
      const doji = candleAt(liveDay, "07:00", Direction.DOJI);
      const result = runBacktest([...history, doji], { ...cfg, dojiPolicy: DojiPolicy.IGNORE });
      expect(result.operations).toHaveLength(0);
    });

    it("COUNT_AS_TIE: empate, banca não muda", () => {
      const { history, liveDay, cfg } = historyAndConfig();
      const doji = candleAt(liveDay, "07:00", Direction.DOJI);
      const result = runBacktest([...history, doji], { ...cfg, dojiPolicy: DojiPolicy.COUNT_AS_TIE });
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].result).toBe("tie");
      expect(result.operations[0].bankrollAfter.toFixed(2)).toBe(cfg.initialBankroll.toFixed(2));
    });

    it("COUNT_AS_LOSS: derrota normal (esgota a escada de 1 nível)", () => {
      const { history, liveDay, cfg } = historyAndConfig();
      const doji = candleAt(liveDay, "07:00", Direction.DOJI);
      const result = runBacktest([...history, doji], { ...cfg, dojiPolicy: DojiPolicy.COUNT_AS_LOSS });
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].result).toBe("loss");
      expect(result.operations[0].profitLoss.toFixed(2)).toBe(cfg.initialEntry.neg().toFixed(2));
    });
  });

  it("entryStrategy contrarian aposta contra a direção predominante", () => {
    const history = days(20, 1).map((d) => candleAt(d, "07:00", Direction.PUT)); // predominante PUT
    const liveDay = days(1, 21)[0];
    const live = [candleAt(liveDay, "07:00", Direction.CALL)]; // contrário do predominante: acerta se for contrarian

    const cfg = config({
      slotCount: 1,
      entryStrategy: "contrarian",
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].entryDirection).toBe(Direction.CALL);
    expect(result.operations[0].result).toBe("win");
  });

  it("nunca olha o futuro: recalcula a direção usando só os dias anteriores a cada dia simulado", () => {
    const history = days(20, 1).map((d) => candleAt(d, "07:00", Direction.PUT)); // histórico: 100% PUT
    const liveDays = days(3, 21);
    const live = liveDays.map((d) => candleAt(d, "07:00", Direction.CALL)); // período do backtest: 100% CALL

    const cfg = config({
      slotCount: 1,
      periodStart: new Date(`${liveDays[0]}T00:00:00Z`),
      periodEnd: new Date(`${liveDays[liveDays.length - 1]}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);

    // previu PUT em todos os 3 dias (só sabia do histórico) e perdeu sempre
    expect(result.operations).toHaveLength(3);
    for (const op of result.operations) {
      expect(op.entryDirection).toBe(Direction.PUT);
      expect(op.actualDirection).toBe(Direction.CALL);
      expect(op.result).toBe("loss");
    }
  });

  it("maxExposureLimit impede abrir a operação quando a escada exigiria mais que o limite", () => {
    const history = strongHistory();
    const liveDay = days(1, 21)[0];
    const live = [
      candleAt(liveDay, "07:00", Direction.CALL),
      candleAt(liveDay, "09:00", Direction.CALL),
      candleAt(liveDay, "12:00", Direction.CALL),
    ];

    const schedule = calculateMode1({
      bankroll: new Decimal(1000),
      payoutPct: new Decimal(85),
      initialEntry: new Decimal(5),
      minProfit: new Decimal(1),
      martingaleLevels: 2,
    });

    const cfg = config({
      maxExposureLimit: schedule.totalCapitalRequired.minus(1), // um centavo abaixo do necessário
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);
    expect(result.operations).toHaveLength(0);
  });

  it("agrega métricas por símbolo, horário, dia da semana e mês", () => {
    const history = days(20, 1).map((d) => candleAt(d, "07:00", Direction.PUT));
    const liveDays = days(2, 21);
    const live = [
      candleAt(liveDays[0], "07:00", Direction.PUT), // vitória
      candleAt(liveDays[1], "07:00", Direction.CALL), // derrota
    ];

    const cfg = config({
      slotCount: 1,
      periodStart: new Date(`${liveDays[0]}T00:00:00Z`),
      periodEnd: new Date(`${liveDays[1]}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);

    expect(result.summary.totalOperations).toBe(2);
    expect(result.summary.wins).toBe(1);
    expect(result.summary.losses).toBe(1);
    expect(result.summary.bySymbol[SYMBOL].operations).toBe(2);
    expect(result.summary.byTimeOfDay["07:00"].operations).toBe(2);
    expect(result.summary.profitFactor).not.toBeNull();
    expect(new Decimal(result.summary.maxDrawdown).gt(0)).toBe(true);
  });
});

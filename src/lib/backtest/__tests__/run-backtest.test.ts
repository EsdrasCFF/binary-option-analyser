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

    // agora uma linha POR ENTRADA tentada: derrota no nível 0, vitória no nível 1
    expect(result.operations).toHaveLength(2);
    const [loss, win] = result.operations;

    const schedule = calculateMode1({
      bankroll: cfg.initialBankroll,
      payoutPct: cfg.payoutPct,
      initialEntry: cfg.initialEntry,
      minProfit: cfg.minProfit,
      martingaleLevels: 2, // slotCount(3) - 1
    });

    expect(loss.result).toBe("loss");
    expect(loss.martingaleLevelReached).toBe(0);
    expect(loss.timeOfDay).toBe("07:00");
    expect(loss.profitLoss.toFixed(2)).toBe(schedule.levels[0].entryValue.neg().toFixed(2));
    expect(loss.dailyCumulativeProfitLoss.toFixed(2)).toBe(schedule.levels[0].entryValue.neg().toFixed(2));

    expect(win.result).toBe("win");
    expect(win.martingaleLevelReached).toBe(1);
    expect(win.timeOfDay).toBe("09:00");
    expect(win.profitLoss.toFixed(2)).toBe(schedule.levels[1].grossProfitIfWin.toFixed(2));
    // a soma das duas linhas do dia bate com o antigo resultado único (net-after-recovery)
    expect(win.bankrollAfter.toFixed(2)).toBe(
      cfg.initialBankroll.plus(schedule.levels[1].netProfitAfterRecovery).toFixed(2)
    );
    expect(win.dailyCumulativeProfitLoss.toFixed(2)).toBe(schedule.levels[1].netProfitAfterRecovery.toFixed(2));
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

    expect(result.operations).toHaveLength(3);
    expect(result.operations.map((o) => o.timeOfDay)).toEqual(["07:00", "09:00", "12:00"]);
    expect(result.operations.map((o) => o.martingaleLevelReached)).toEqual([0, 1, 2]);
    expect(result.operations.map((o) => o.result)).toEqual(["loss", "loss", "win"]);
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

    // esgotar a escada agora vira 3 linhas de derrota (uma por nível), não mais 1 linha agregada
    expect(result.operations).toHaveLength(3);
    expect(result.operations.every((o) => o.result === "loss")).toBe(true);
    expect(result.operations.map((o) => o.martingaleLevelReached)).toEqual([0, 1, 2]);

    const schedule = calculateMode1({
      bankroll: cfg.initialBankroll,
      payoutPct: cfg.payoutPct,
      initialEntry: cfg.initialEntry,
      minProfit: cfg.minProfit,
      martingaleLevels: 2,
    });
    const last = result.operations[2];
    // a soma das 3 derrotas individuais bate com a antiga exposição total acumulada
    expect(last.bankrollAfter.toFixed(2)).toBe(
      cfg.initialBankroll.minus(schedule.levels[2].accumulatedExposure).toFixed(2)
    );
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

    expect(result.operations).toHaveLength(2); // só 2 horários elegíveis: níveis 0 e 1
    expect(result.operations[0].martingaleLevelReached).toBe(0);
    expect(result.operations[1].martingaleLevelReached).toBe(1);
    expect(result.operations[1].timeOfDay).toBe("09:00");
    expect(result.operations[1].result).toBe("win");
  });

  it("empate (DOJI count_as_tie) no meio da escada encerra o dia imediatamente, sem tocar os níveis seguintes", () => {
    const history = strongHistory();
    const liveDay = days(1, 21)[0];
    const live = [
      candleAt(liveDay, "07:00", Direction.DOJI),
      candleAt(liveDay, "09:00", Direction.CALL), // nunca deveria ser tocado
      candleAt(liveDay, "12:00", Direction.CALL), // nunca deveria ser tocado
    ];

    const cfg = config({
      dojiPolicy: DojiPolicy.COUNT_AS_TIE,
      periodStart: new Date(`${liveDay}T00:00:00Z`),
      periodEnd: new Date(`${liveDay}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].result).toBe("tie");
    expect(result.operations[0].martingaleLevelReached).toBe(0);
    expect(result.operations[0].bankrollAfter.toFixed(2)).toBe(cfg.initialBankroll.toFixed(2));

    expect(result.summary.dailyResults).toHaveLength(1);
    expect(result.summary.dailyResults[0]).toMatchObject({ entries: 1, finalLevel: 0, result: "tie" });
    expect(result.summary.wins).toBe(0);
    expect(result.summary.losses).toBe(0);
    expect(result.summary.ties).toBe(1);
    expect(result.summary.maxWinStreakDays).toBe(0);
    expect(result.summary.maxLossStreakDays).toBe(0);
  });

  it("métricas de dia (profitFactor, byMartingaleLevel, streaks) usam o resultado líquido de cada DIA, não de cada entrada", () => {
    const history = days(20, 1).flatMap((d) => [
      candleAt(d, "07:00", Direction.PUT),
      candleAt(d, "09:00", Direction.PUT),
    ]);
    const liveDays = days(2, 21);
    const live = [
      candleAt(liveDays[0], "07:00", Direction.CALL), // dia 1, nível 0: perde
      candleAt(liveDays[0], "09:00", Direction.PUT), // dia 1, nível 1: vence -> dia = WIN
      candleAt(liveDays[1], "07:00", Direction.CALL), // dia 2, nível 0: perde
      candleAt(liveDays[1], "09:00", Direction.CALL), // dia 2, nível 1: perde -> dia = LOSS (martingale completo)
    ];

    const cfg = config({
      slotCount: 2,
      periodStart: new Date(`${liveDays[0]}T00:00:00Z`),
      periodEnd: new Date(`${liveDays[1]}T23:59:59Z`),
    });
    const result = runBacktest([...history, ...live], cfg);

    const schedule = calculateMode1({
      bankroll: cfg.initialBankroll,
      payoutPct: cfg.payoutPct,
      initialEntry: cfg.initialEntry,
      minProfit: cfg.minProfit,
      martingaleLevels: 1,
    });
    const dayWinNet = schedule.levels[1].netProfitAfterRecovery;
    const dayLossNet = schedule.levels[1].accumulatedExposure;

    expect(result.operations).toHaveLength(4);
    expect(result.summary.totalOperations).toBe(4); // entradas individuais
    expect(result.summary.totalDays).toBe(2);
    expect(result.summary.wins).toBe(1); // dias vencidos, não entradas
    expect(result.summary.losses).toBe(1);

    expect(result.summary.dailyResults).toHaveLength(2);
    expect(result.summary.dailyResults[0]).toMatchObject({ entries: 2, finalLevel: 1, result: "win" });
    expect(result.summary.dailyResults[1]).toMatchObject({ entries: 2, finalLevel: 1, result: "loss" });
    expect(result.summary.dailyResults[0].profitLoss).toBe(dayWinNet.toFixed(2));
    expect(result.summary.dailyResults[1].profitLoss).toBe(dayLossNet.neg().toFixed(2));

    // profitFactor calculado sobre o líquido de cada dia, não sobre os buckets brutos por entrada
    expect(result.summary.profitFactor).toBe(dayWinNet.div(dayLossNet).toFixed(4));

    expect(result.summary.byMartingaleLevel["0"]).toMatchObject({ wins: 0, losses: 2 });
    expect(result.summary.byMartingaleLevel["1"]).toMatchObject({ wins: 1, losses: 1 });

    expect(result.summary.maxWinStreakDays).toBe(1);
    expect(result.summary.maxLossStreakDays).toBe(1);
    expect(result.summary.fullMartingaleLosses).toBe(result.summary.losses);
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

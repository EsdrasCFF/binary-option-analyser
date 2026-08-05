/**
 * Motor de backtest cronológico.
 *
 * Diferença fundamental para `run-analysis.ts`: aqui a direção predominante de
 * cada horário é recalculada a cada dia simulado, usando **apenas os candles
 * anteriores àquele dia** (rolling window). A Analysis estática usa o período
 * inteiro de uma vez — reaproveitar esse resultado direto no backtest seria
 * "olhar o futuro" (look-ahead bias), o erro clássico que invalida um backtest.
 *
 * Uma "operação" pode abranger vários candles: se o candle de abertura perder,
 * o Martingale persegue a perda no candle seguinte da mesma série (mesmo
 * símbolo+timeframe), com o valor do próximo nível, até vencer ou esgotar
 * `martingaleLevels` — nunca no dia seguinte. Por isso uma operação conta como
 * UMA linha de resultado mesmo cobrindo vários candles.
 *
 * Puro: recebe `Candle[]` já carregados e devolve operações + métricas
 * agregadas, sem tocar banco — mesma separação usada em `run-analysis.ts`.
 */
import { Decimal } from "decimal.js";
import { DateTime } from "luxon";
import { Candle, Direction, DojiPolicy, classifyCandle } from "@/lib/core/candle-classifier";
import { TimeOfDay, analyzeTimeSlot, suggestedEntryDirection } from "@/lib/core/pattern-analyzer";
import { calculateMode1, MartingaleValidationError } from "@/lib/core/martingale-calculator";
import { formatTimeOfDay } from "@/lib/analysis/run-analysis";

export interface BacktestTarget {
  currencyPairId: string;
  symbol: string;
  timeframe: string;
  timeOfDay: TimeOfDay;
  timezone: string;
  dojiTolerancePct: Decimal;
  /** Mínimo de ocorrências válidas na janela retroativa para o dia ser operado (vem da Analysis original). */
  minValidDays: number;
}

export interface BacktestRunConfig {
  entryStrategy: "same_direction" | "contrarian";
  payoutPct: Decimal;
  initialBankroll: Decimal;
  initialEntry: Decimal;
  minProfit: Decimal;
  martingaleLevels: number;
  maxExposureLimit?: Decimal;
  dailyLossLimit?: Decimal;
  maxOperationsPerDay?: number;
  dojiPolicy: DojiPolicy;
  /** Guarda contra o mesmo horário local ocorrer 2x no mesmo dia (ex: troca de horário de verão). */
  oneEntryPerTimeSlot: boolean;
  periodStart: Date;
  periodEnd: Date;
}

export interface BacktestOperationResult {
  operationDate: string; // yyyy-MM-dd, no timezone do target
  currencyPairId: string;
  symbol: string;
  timeOfDay: string; // "HH:mm"
  entryDirection: Direction;
  actualDirection: Direction; // direção do candle que resolveu a operação
  martingaleLevelReached: number;
  entryValue: Decimal; // valor usado no nível que resolveu
  result: "win" | "loss" | "tie";
  profitLoss: Decimal;
  bankrollAfter: Decimal;
}

export interface GroupStats {
  operations: number;
  wins: number;
  losses: number;
  ties: number;
  netProfitLoss: string;
}

export interface BacktestSummary {
  finalBankroll: string;
  totalOperations: number;
  wins: number;
  losses: number;
  ties: number;
  maxDrawdown: string;
  /** null quando não há perdas no período (divisão por zero não se aplica). */
  profitFactor: string | null;
  byCurrencyPair: Record<string, GroupStats>;
  byTimeOfDay: Record<string, GroupStats>;
  byWeekday: Record<string, GroupStats>; // "1".."7" (luxon: 1=segunda)
  byMonth: Record<string, GroupStats>; // "yyyy-MM"
}

export interface BacktestRunResult {
  operations: BacktestOperationResult[];
  summary: BacktestSummary;
}

function candleKey(symbol: string, timeframe: string): string {
  return `${symbol}|${timeframe}`;
}

/** Índice por (symbol,timeframe): candles ordenados + mapa openTime ISO -> candle, para achar "o próximo candle" sem depender de duração fixa do timeframe. */
function indexCandles(candles: Candle[]) {
  const bySeries = new Map<string, Candle[]>();
  for (const c of candles) {
    const key = candleKey(c.symbol, c.timeframe);
    let list = bySeries.get(key);
    if (!list) {
      list = [];
      bySeries.set(key, list);
    }
    list.push(c);
  }
  const byOpenTime = new Map<string, Map<string, Candle>>();
  for (const [key, list] of bySeries) {
    list.sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
    byOpenTime.set(key, new Map(list.map((c) => [c.openTime.toISOString(), c])));
  }
  return { bySeries, byOpenTime };
}

function emptyGroupStats(): GroupStats {
  return { operations: 0, wins: 0, losses: 0, ties: 0, netProfitLoss: "0.00" };
}

function addToGroup(map: Record<string, GroupStats>, key: string, op: BacktestOperationResult): void {
  const stats = map[key] ?? emptyGroupStats();
  stats.operations += 1;
  if (op.result === "win") stats.wins += 1;
  else if (op.result === "loss") stats.losses += 1;
  else stats.ties += 1;
  stats.netProfitLoss = new Decimal(stats.netProfitLoss).plus(op.profitLoss).toFixed(2);
  map[key] = stats;
}

/** Uma tentativa de operação: (target, dia local) — pode gerar 0 ou mais operações reais se oneEntryPerTimeSlot=false e o horário ocorrer >1x no dia (ex: DST). */
interface Candidate {
  target: BacktestTarget;
  localDate: string; // yyyy-MM-dd
  entryCandle: Candle;
}

function buildCandidates(
  target: BacktestTarget,
  seriesCandles: Candle[],
  config: BacktestRunConfig
): Candidate[] {
  const candidates: Candidate[] = [];
  const seenDates = new Set<string>();

  for (const candle of seriesCandles) {
    const local = DateTime.fromJSDate(candle.openTime, { zone: "utc" }).setZone(target.timezone);
    if (local.hour !== target.timeOfDay.hour || local.minute !== target.timeOfDay.minute) continue;
    if (candle.openTime < config.periodStart || candle.openTime > config.periodEnd) continue;

    const localDate = local.toISODate()!;
    if (config.oneEntryPerTimeSlot && seenDates.has(localDate)) continue;
    seenDates.add(localDate);

    candidates.push({ target, localDate, entryCandle: candle });
  }
  return candidates;
}

export function runBacktest(
  candles: Candle[],
  targets: BacktestTarget[],
  config: BacktestRunConfig
): BacktestRunResult {
  const { bySeries, byOpenTime } = indexCandles(candles);

  const allCandidates = targets.flatMap((target) =>
    buildCandidates(target, bySeries.get(candleKey(target.symbol, target.timeframe)) ?? [], config)
  );
  allCandidates.sort((a, b) => a.entryCandle.openTime.getTime() - b.entryCandle.openTime.getTime());

  let bankroll = config.initialBankroll;
  let peakBankroll = config.initialBankroll;
  let maxDrawdown = new Decimal(0);

  const dayOperationsCount = new Map<string, number>();
  const dayRealizedLoss = new Map<string, Decimal>();

  const operations: BacktestOperationResult[] = [];
  const byCurrencyPair: Record<string, GroupStats> = {};
  const byTimeOfDay: Record<string, GroupStats> = {};
  const byWeekday: Record<string, GroupStats> = {};
  const byMonth: Record<string, GroupStats> = {};

  for (const candidate of allCandidates) {
    const { target, localDate, entryCandle } = candidate;
    const dayKey = `${target.timezone}|${localDate}`;

    if (config.maxOperationsPerDay !== undefined) {
      const opened = dayOperationsCount.get(dayKey) ?? 0;
      if (opened >= config.maxOperationsPerDay) continue;
    }
    if (config.dailyLossLimit !== undefined) {
      const lossToday = dayRealizedLoss.get(dayKey) ?? new Decimal(0);
      if (lossToday.gte(config.dailyLossLimit)) continue;
    }

    // 1) rolling window: só candles ANTERIORES ao dia simulado (nunca o próprio dia ou o futuro)
    const startOfDayUtc = DateTime.fromISO(localDate, { zone: target.timezone }).toUTC().toJSDate();
    const seriesCandles = bySeries.get(candleKey(target.symbol, target.timeframe)) ?? [];
    const priorCandles = seriesCandles.filter((c) => c.openTime < startOfDayUtc);

    const rolling = analyzeTimeSlot({
      candles: priorCandles,
      symbol: target.symbol,
      timeframe: target.timeframe,
      targetTime: target.timeOfDay,
      timezone: target.timezone,
      dojiTolerancePct: target.dojiTolerancePct,
      dojiPolicy: config.dojiPolicy,
    });

    if (rolling.totalValid < target.minValidDays) continue; // amostra insuficiente até aqui: não opera

    const entryDirection = suggestedEntryDirection(rolling, config.entryStrategy === "contrarian");
    if (entryDirection === null) continue;

    // 2) monta o cronograma de Martingale contra a banca ATUAL (compounding)
    let schedule;
    try {
      schedule = calculateMode1({
        bankroll,
        payoutPct: config.payoutPct,
        initialEntry: config.initialEntry,
        minProfit: config.minProfit,
        martingaleLevels: config.martingaleLevels,
      });
    } catch (e) {
      if (e instanceof MartingaleValidationError) continue; // banca não suporta mais o cronograma: pula
      throw e;
    }
    if (config.maxExposureLimit !== undefined && schedule.totalCapitalRequired.gt(config.maxExposureLimit)) {
      continue;
    }

    // 3) percorre os níveis, avançando para o PRÓXIMO CANDLE da série em caso de derrota (nunca o dia seguinte)
    let currentCandle: Candle | undefined = entryCandle;
    let level = 0;
    let resolved: BacktestOperationResult | null = null;

    while (currentCandle && level <= config.martingaleLevels) {
      const levelInfo = schedule.levels[level];
      const actualDirection = classifyCandle(currentCandle, target.dojiTolerancePct);

      if (actualDirection === Direction.DOJI) {
        if (config.dojiPolicy === DojiPolicy.IGNORE) {
          resolved = null; // não conta como operação: nem vitória, nem derrota, nem tentativa
          break;
        }
        if (config.dojiPolicy === DojiPolicy.COUNT_AS_TIE) {
          resolved = {
            operationDate: localDate,
            currencyPairId: target.currencyPairId,
            symbol: target.symbol,
            timeOfDay: formatTimeOfDay(target.timeOfDay),
            entryDirection,
            actualDirection,
            martingaleLevelReached: level,
            entryValue: levelInfo.entryValue,
            result: "tie",
            profitLoss: new Decimal(0),
            bankrollAfter: bankroll,
          };
          break;
        }
        // COUNT_AS_LOSS: cai para o mesmo tratamento de derrota abaixo
      }

      const won = actualDirection === entryDirection;
      if (won) {
        const profit = levelInfo.netProfitAfterRecovery;
        bankroll = bankroll.plus(profit).toDecimalPlaces(2);
        resolved = {
          operationDate: localDate,
          currencyPairId: target.currencyPairId,
          symbol: target.symbol,
          timeOfDay: formatTimeOfDay(target.timeOfDay),
          entryDirection,
          actualDirection,
          martingaleLevelReached: level,
          entryValue: levelInfo.entryValue,
          result: "win",
          profitLoss: profit,
          bankrollAfter: bankroll,
        };
        break;
      }

      if (level === config.martingaleLevels) {
        // perdeu no último nível disponível: derrota final da operação
        const loss = levelInfo.accumulatedExposure;
        bankroll = bankroll.minus(loss).toDecimalPlaces(2);
        resolved = {
          operationDate: localDate,
          currencyPairId: target.currencyPairId,
          symbol: target.symbol,
          timeOfDay: formatTimeOfDay(target.timeOfDay),
          entryDirection,
          actualDirection,
          martingaleLevelReached: level,
          entryValue: levelInfo.entryValue,
          result: "loss",
          profitLoss: loss.neg(),
          bankrollAfter: bankroll,
        };
        break;
      }

      // perdeu mas ainda há níveis: persegue no PRÓXIMO candle real da série
      const key = candleKey(target.symbol, target.timeframe);
      currentCandle = byOpenTime.get(key)?.get(currentCandle.closeTime.toISOString());
      level += 1;
      // se currentCandle vier undefined (gap de dados), o while termina sem `resolved`:
      // não há como saber o resultado real, então a operação é descartada (não conta como win/loss/tie)
    }

    if (resolved === null) continue;

    operations.push(resolved);
    dayOperationsCount.set(dayKey, (dayOperationsCount.get(dayKey) ?? 0) + 1);
    if (resolved.result === "loss") {
      dayRealizedLoss.set(dayKey, (dayRealizedLoss.get(dayKey) ?? new Decimal(0)).plus(resolved.profitLoss.abs()));
    }

    peakBankroll = Decimal.max(peakBankroll, bankroll);
    const drawdown = peakBankroll.minus(bankroll);
    maxDrawdown = Decimal.max(maxDrawdown, drawdown);

    addToGroup(byCurrencyPair, target.symbol, resolved);
    addToGroup(byTimeOfDay, resolved.timeOfDay, resolved);
    const local = DateTime.fromISO(localDate, { zone: target.timezone });
    addToGroup(byWeekday, String(local.weekday), resolved);
    addToGroup(byMonth, local.toFormat("yyyy-MM"), resolved);
  }

  const wins = operations.filter((o) => o.result === "win").length;
  const losses = operations.filter((o) => o.result === "loss").length;
  const ties = operations.filter((o) => o.result === "tie").length;

  const grossProfit = operations
    .filter((o) => o.result === "win")
    .reduce((acc, o) => acc.plus(o.profitLoss), new Decimal(0));
  const grossLoss = operations
    .filter((o) => o.result === "loss")
    .reduce((acc, o) => acc.plus(o.profitLoss.abs()), new Decimal(0));

  return {
    operations,
    summary: {
      finalBankroll: bankroll.toFixed(2),
      totalOperations: operations.length,
      wins,
      losses,
      ties,
      maxDrawdown: maxDrawdown.toFixed(2),
      profitFactor: grossLoss.gt(0) ? grossProfit.div(grossLoss).toFixed(4) : null,
      byCurrencyPair,
      byTimeOfDay,
      byWeekday,
      byMonth,
    },
  };
}

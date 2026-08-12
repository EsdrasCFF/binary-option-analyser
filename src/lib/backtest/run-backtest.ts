/**
 * Motor de backtest cronológico.
 *
 * Mecânica (definida junto com o usuário — a primeira versão perseguia a
 * perda no candle seguinte do mesmo horário, não era isso que fazia sentido
 * pro caso de uso real): o Martingale NÃO persegue a perda na vela seguinte
 * do mesmo horário — ele
 * percorre os OUTROS horários mais fortes do dia, em ordem crescente de
 * horário. A cada dia simulado, o motor:
 *
 *   1. Refaz o ranking do zero (mesma lógica da Analysis, via
 *      `analyzeAllSlots`), usando **só candles anteriores àquele dia**
 *      (rolling window — nunca olha o futuro).
 *   2. Filtra pelos mesmos limiares da Analysis original (`minRepetitionPct`,
 *      `minValidDays`) e pega os top N (`slotCount` = quantidade de horários
 *      que o usuário selecionou na tela de ranking).
 *   3. Ordena esses N horários por horário do dia (crescente) — essa é a
 *      "escada" do Martingale do dia: nível 0 = horário mais cedo.
 *   4. Entra no nível 0; se perder, tenta o nível 1 (próximo horário da
 *      escada, não o próximo candle do mesmo horário); e assim por diante,
 *      até vencer ou esgotar a escada do dia.
 *
 * Consequências importantes desse desenho:
 * - Uma operação = um dia inteiro (no máximo 1 operação por dia), não mais
 *   uma operação por horário selecionado.
 * - Os "níveis de Martingale" de cada dia são `slotCount - 1`, MAS podem ser
 *   menores num dia específico se nem todos os N horários passarem no
 *   filtro de amostra/percentual naquele ponto da simulação — o motor usa o
 *   que estiver disponível, nunca inventa horário.
 * - Se faltar o candle de algum horário da escada naquele dia (gap de
 *   dados), o dia inteiro é descartado (não fabrica resultado parcial).
 *
 * Puro: recebe `Candle[]` já carregados e devolve operações + métricas,
 * sem tocar banco — mesma separação usada em `run-analysis.ts`.
 */
import { Decimal } from "decimal.js";
import { DateTime } from "luxon";
import { Candle, Direction, DojiPolicy, classifyCandle } from "@/lib/core/candle-classifier";
import { PatternResult, suggestedEntryDirection } from "@/lib/core/pattern-analyzer";
import { calculateMode1, MartingaleValidationError } from "@/lib/core/martingale-calculator";
import { localTimeOf } from "@/lib/core/local-time";
import { analyzeAllSlots, formatTimeOfDay } from "@/lib/analysis/run-analysis";

export interface BacktestRunConfig {
  // escopo para redescobrir/reranquear horários a cada dia (vem da Analysis original)
  timeframe: string;
  timezone: string;
  startTime?: string | null;
  endTime?: string | null;
  weekdays?: number[] | null;
  dojiTolerancePct: Decimal;
  minRepetitionPct: Decimal;
  minValidDays: number;
  /** Quantidade de horários selecionados na tela de ranking: níveis do dia = min(slotCount, elegíveis) - 1. */
  slotCount: number;

  entryStrategy: "same_direction" | "contrarian";
  payoutPct: Decimal;
  initialBankroll: Decimal;
  initialEntry: Decimal;
  minProfit: Decimal;
  maxExposureLimit?: Decimal;
  dojiPolicy: DojiPolicy;
  periodStart: Date;
  periodEnd: Date;
}

export interface BacktestOperationResult {
  operationDate: string; // yyyy-MM-dd, no timezone do backtest
  symbol: string;
  timeOfDay: string; // "HH:mm" do horário da escada que resolveu a operação
  entryDirection: Direction;
  actualDirection: Direction;
  martingaleLevelReached: number;
  entryValue: Decimal;
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
  profitFactor: string | null;
  bySymbol: Record<string, GroupStats>;
  byTimeOfDay: Record<string, GroupStats>;
  byWeekday: Record<string, GroupStats>;
  byMonth: Record<string, GroupStats>;
}

export interface BacktestRunResult {
  operations: BacktestOperationResult[];
  summary: BacktestSummary;
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

function enumerateLocalDays(periodStart: Date, periodEnd: Date, timezone: string): string[] {
  const start = DateTime.fromJSDate(periodStart, { zone: "utc" }).setZone(timezone).startOf("day");
  const end = DateTime.fromJSDate(periodEnd, { zone: "utc" }).setZone(timezone).startOf("day");
  const days: string[] = [];
  for (let cur = start; cur <= end; cur = cur.plus({ days: 1 })) {
    days.push(cur.toISODate()!);
  }
  return days;
}

/** Índice candle por (symbol, dia local, "HH:mm" local) — primeira ocorrência vence (guarda contra DST duplicado). */
function indexBySymbolDayTime(candles: Candle[], timezone: string): Map<string, Candle> {
  const map = new Map<string, Candle>();
  for (const c of candles) {
    const local = localTimeOf(c, timezone);
    const key = `${c.symbol}|${local.dateISO}|${formatTimeOfDay({ hour: local.hour, minute: local.minute })}`;
    if (!map.has(key)) map.set(key, c);
  }
  return map;
}

function minutesOf(time: { hour: number; minute: number }): number {
  return time.hour * 60 + time.minute;
}

export function runBacktest(candles: Candle[], config: BacktestRunConfig): BacktestRunResult {
  const relevant = candles.filter((c) => c.timeframe === config.timeframe);
  const candleIndex = indexBySymbolDayTime(relevant, config.timezone);
  const days = enumerateLocalDays(config.periodStart, config.periodEnd, config.timezone);

  let bankroll = config.initialBankroll;
  let peakBankroll = config.initialBankroll;
  let maxDrawdown = new Decimal(0);

  const operations: BacktestOperationResult[] = [];
  const bySymbol: Record<string, GroupStats> = {};
  const byTimeOfDay: Record<string, GroupStats> = {};
  const byWeekday: Record<string, GroupStats> = {};
  const byMonth: Record<string, GroupStats> = {};

  for (const day of days) {
    const startOfDayUtc = DateTime.fromISO(day, { zone: config.timezone }).toUTC().toJSDate();
    const priorCandles = relevant.filter((c) => c.openTime < startOfDayUtc);

    // 1) refaz o ranking do zero, só com o que já era conhecido antes deste dia
    const allSlots = analyzeAllSlots(priorCandles, {
      timeframe: config.timeframe,
      timezone: config.timezone,
      startTime: config.startTime,
      endTime: config.endTime,
      weekdays: config.weekdays,
      dojiTolerancePct: config.dojiTolerancePct,
      dojiPolicy: config.dojiPolicy,
      minValidDays: config.minValidDays,
    });

    const eligible = allSlots
      .filter((r) => r.totalValid >= config.minValidDays && r.repetitionPct.gte(config.minRepetitionPct))
      .sort((a, b) => b.repetitionPct.cmp(a.repetitionPct));

    const ladder = eligible
      .slice(0, config.slotCount)
      .sort((a, b) => minutesOf(a.timeOfDay) - minutesOf(b.timeOfDay));

    if (ladder.length === 0) continue; // nenhum horário elegível hoje: não opera

    // 2) monta o cronograma de Martingale contra a banca ATUAL, com os níveis disponíveis hoje
    const levelsToday = ladder.length - 1;
    let schedule;
    try {
      schedule = calculateMode1({
        bankroll,
        payoutPct: config.payoutPct,
        initialEntry: config.initialEntry,
        minProfit: config.minProfit,
        martingaleLevels: levelsToday,
      });
    } catch (e) {
      if (e instanceof MartingaleValidationError) continue; // banca não suporta a escada de hoje: pula o dia
      throw e;
    }
    if (config.maxExposureLimit !== undefined && schedule.totalCapitalRequired.gt(config.maxExposureLimit)) {
      continue;
    }

    // 3) percorre a escada do dia: nível 0 = horário mais cedo
    let resolved: BacktestOperationResult | null = null;
    for (let level = 0; level < ladder.length; level++) {
      const slot: PatternResult = ladder[level];
      const entryCandle = candleIndex.get(`${slot.symbol}|${day}|${formatTimeOfDay(slot.timeOfDay)}`);
      if (!entryCandle) {
        // falta dado justamente no horário que a escada precisava: não dá pra saber o resultado real
        resolved = null;
        break;
      }

      const entryDirection = suggestedEntryDirection(slot, config.entryStrategy === "contrarian");
      if (entryDirection === null) {
        resolved = null;
        break;
      }

      const levelInfo = schedule.levels[level];
      const actualDirection = classifyCandle(entryCandle, config.dojiTolerancePct);

      if (actualDirection === Direction.DOJI) {
        if (config.dojiPolicy === DojiPolicy.IGNORE) {
          resolved = null;
          break;
        }
        if (config.dojiPolicy === DojiPolicy.COUNT_AS_TIE) {
          resolved = {
            operationDate: day,
            symbol: slot.symbol,
            timeOfDay: formatTimeOfDay(slot.timeOfDay),
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
        // COUNT_AS_LOSS: cai no mesmo tratamento de derrota abaixo
      }

      const won = actualDirection === entryDirection;
      if (won) {
        const profit = levelInfo.netProfitAfterRecovery;
        bankroll = bankroll.plus(profit).toDecimalPlaces(2);
        resolved = {
          operationDate: day,
          symbol: slot.symbol,
          timeOfDay: formatTimeOfDay(slot.timeOfDay),
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

      if (level === ladder.length - 1) {
        // perdeu no último horário da escada de hoje: derrota final do dia
        const loss = levelInfo.accumulatedExposure;
        bankroll = bankroll.minus(loss).toDecimalPlaces(2);
        resolved = {
          operationDate: day,
          symbol: slot.symbol,
          timeOfDay: formatTimeOfDay(slot.timeOfDay),
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
      // perdeu mas ainda há horários na escada de hoje: segue pro próximo nível
    }

    if (resolved === null) continue;

    operations.push(resolved);
    peakBankroll = Decimal.max(peakBankroll, bankroll);
    maxDrawdown = Decimal.max(maxDrawdown, peakBankroll.minus(bankroll));

    addToGroup(bySymbol, resolved.symbol, resolved);
    addToGroup(byTimeOfDay, resolved.timeOfDay, resolved);
    const local = DateTime.fromISO(day, { zone: config.timezone });
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
      bySymbol,
      byTimeOfDay,
      byWeekday,
      byMonth,
    },
  };
}

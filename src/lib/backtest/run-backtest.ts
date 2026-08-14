/**
 * Motor de backtest cronológico.
 *
 * Mecânica (definida junto com o usuário): o Martingale NÃO persegue a perda
 * na vela seguinte do mesmo horário — ele percorre os OUTROS horários mais
 * fortes do dia, em ordem crescente de horário. A cada dia simulado, o motor:
 *
 *   1. Refaz o ranking do zero (mesma lógica da Analysis, via
 *      `analyzeAllSlots`), usando **só candles anteriores àquele dia**
 *      (rolling window — nunca olha o futuro; a "análise histórica" e o
 *      "forward test" do usuário são, na prática, este retrain contínuo dia
 *      a dia, e não uma janela de treino congelada).
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
 * - No máximo 1 CICLO de Martingale por dia, mas cada nível tentado dentro
 *   desse ciclo gera sua PRÓPRIA linha em `operations` (derrota nível 0,
 *   derrota nível 1, vitória nível 2, ...) — o objetivo diário é 1 vitória;
 *   assim que uma entrada vence, o dia encerra e os horários restantes da
 *   escada não são usados.
 * - Os "níveis de Martingale" de cada dia são `slotCount - 1`, MAS podem ser
 *   menores num dia específico se nem todos os N horários passarem no
 *   filtro de amostra/percentual naquele ponto da simulação — o motor usa o
 *   que estiver disponível, nunca inventa horário.
 * - Se faltar o candle de algum horário da escada naquele dia (gap de
 *   dados), o dia inteiro é descartado (não fabrica resultado parcial) — as
 *   linhas de um dia só são gravadas quando ele resolve por completo
 *   (vitória, empate ou derrota esgotando a escada).
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
  timeOfDay: string; // "HH:mm" do horário desse nível da escada
  entryDirection: Direction;
  actualDirection: Direction;
  martingaleLevelReached: number; // nível desta entrada específica (0 = primeira do dia)
  entryValue: Decimal;
  result: "win" | "loss" | "tie";
  profitLoss: Decimal; // resultado financeiro desta entrada isoladamente
  bankrollAfter: Decimal; // banca corrida (geral) após esta entrada
  dailyCumulativeProfitLoss: Decimal; // soma corrida do P&L dentro do dia, após esta entrada
}

export interface GroupStats {
  operations: number;
  wins: number;
  losses: number;
  ties: number;
  netProfitLoss: string;
}

export interface DailyResult {
  date: string; // yyyy-MM-dd
  entries: number;
  finalLevel: number;
  symbol: string;
  timeOfDay: string;
  result: "win" | "loss" | "tie";
  profitLoss: string; // resultado financeiro líquido do dia (soma de todas as entradas)
}

export interface BacktestSummary {
  finalBankroll: string;
  /** Total de ENTRADAS individuais (não de dias) — ver `totalDays` para a contagem por dia. */
  totalOperations: number;
  /** Dias vencidos (não entradas) — a estratégia busca 1 vitória por dia, não maximizar entradas. */
  wins: number;
  losses: number;
  ties: number;
  maxDrawdown: string;
  /** Calculado sobre o resultado líquido de cada DIA (não sobre entradas isoladas). */
  profitFactor: string | null;
  bySymbol: Record<string, GroupStats>;
  byTimeOfDay: Record<string, GroupStats>;
  byWeekday: Record<string, GroupStats>;
  byMonth: Record<string, GroupStats>;
  /** Granularidade por ENTRADA (não por dia) — ex: byMartingaleLevel["0"].wins = vitórias no nível 0. */
  byMartingaleLevel: Record<string, GroupStats>;
  totalDays: number;
  dailyWinPct: string;
  dailyLossPct: string;
  /** Equivalente a `losses`: neste desenho um dia só perde esgotando a escada por completo. */
  fullMartingaleLosses: number;
  maxWinStreakDays: number;
  maxLossStreakDays: number;
  returnPct: string;
  dailyResults: DailyResult[];
}

export interface BacktestRunResult {
  operations: BacktestOperationResult[];
  summary: BacktestSummary;
}

function emptyGroupStats(): GroupStats {
  return { operations: 0, wins: 0, losses: 0, ties: 0, netProfitLoss: "0.00" };
}

function addToGroup(
  map: Record<string, GroupStats>,
  key: string,
  result: "win" | "loss" | "tie",
  profitLoss: Decimal
): void {
  const stats = map[key] ?? emptyGroupStats();
  stats.operations += 1;
  if (result === "win") stats.wins += 1;
  else if (result === "loss") stats.losses += 1;
  else stats.ties += 1;
  stats.netProfitLoss = new Decimal(stats.netProfitLoss).plus(profitLoss).toFixed(2);
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
  const dailyResults: DailyResult[] = [];
  const bySymbol: Record<string, GroupStats> = {};
  const byTimeOfDay: Record<string, GroupStats> = {};
  const byWeekday: Record<string, GroupStats> = {};
  const byMonth: Record<string, GroupStats> = {};
  const byMartingaleLevel: Record<string, GroupStats> = {};

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

    // 3) percorre a escada do dia, acumulando uma linha por entrada tentada —
    // só é aplicado (commitado) se o dia resolver por completo (sem gap de
    // dado, doji indeterminado ou direção indecidível no meio do caminho)
    const dayOps: BacktestOperationResult[] = [];
    let dayRunningBankroll = bankroll;
    let dayCumulative = new Decimal(0);
    let aborted = false;

    for (let level = 0; level < ladder.length; level++) {
      const slot: PatternResult = ladder[level];
      const entryCandle = candleIndex.get(`${slot.symbol}|${day}|${formatTimeOfDay(slot.timeOfDay)}`);
      if (!entryCandle) {
        // falta dado justamente no horário que a escada precisava: não dá pra saber o resultado real
        aborted = true;
        break;
      }

      const entryDirection = suggestedEntryDirection(slot, config.entryStrategy === "contrarian");
      if (entryDirection === null) {
        aborted = true;
        break;
      }

      const levelInfo = schedule.levels[level];
      const actualDirection = classifyCandle(entryCandle, config.dojiTolerancePct);

      let result: "win" | "loss" | "tie" | null = null;
      let profitLoss = new Decimal(0);

      if (actualDirection === Direction.DOJI) {
        if (config.dojiPolicy === DojiPolicy.IGNORE) {
          aborted = true;
          break;
        }
        if (config.dojiPolicy === DojiPolicy.COUNT_AS_TIE) {
          result = "tie";
          profitLoss = new Decimal(0);
        }
        // COUNT_AS_LOSS: cai no mesmo tratamento de derrota abaixo (result continua null)
      }

      if (result === null) {
        const won = actualDirection === entryDirection;
        result = won ? "win" : "loss";
        // vitória: só o lucro bruto DESTE nível (derrotas anteriores já são linhas próprias);
        // derrota: dinheiro realmente perdido é a própria entrada deste nível
        profitLoss = won ? levelInfo.grossProfitIfWin : levelInfo.entryValue.neg();
      }

      dayRunningBankroll = dayRunningBankroll.plus(profitLoss).toDecimalPlaces(2);
      dayCumulative = dayCumulative.plus(profitLoss);
      dayOps.push({
        operationDate: day,
        symbol: slot.symbol,
        timeOfDay: formatTimeOfDay(slot.timeOfDay),
        entryDirection,
        actualDirection,
        martingaleLevelReached: level,
        entryValue: levelInfo.entryValue,
        result,
        profitLoss,
        bankrollAfter: dayRunningBankroll,
        dailyCumulativeProfitLoss: dayCumulative,
      });

      if (result !== "loss") break; // vitória ou empate encerram o dia; derrota segue pro próximo nível
    }

    if (aborted || dayOps.length === 0) continue;

    // 4) dia resolvido: commita as linhas, atualiza banca e métricas linha a linha
    for (const op of dayOps) {
      operations.push(op);
      bankroll = op.bankrollAfter;
      peakBankroll = Decimal.max(peakBankroll, bankroll);
      maxDrawdown = Decimal.max(maxDrawdown, peakBankroll.minus(bankroll));

      addToGroup(byMartingaleLevel, String(op.martingaleLevelReached), op.result, op.profitLoss);
    }

    const last = dayOps[dayOps.length - 1];
    dailyResults.push({
      date: day,
      entries: dayOps.length,
      finalLevel: last.martingaleLevelReached,
      symbol: last.symbol,
      timeOfDay: last.timeOfDay,
      result: last.result,
      profitLoss: last.dailyCumulativeProfitLoss.toFixed(2),
    });

    const dayProfitLoss = last.dailyCumulativeProfitLoss;
    addToGroup(bySymbol, last.symbol, last.result, dayProfitLoss);
    addToGroup(byTimeOfDay, last.timeOfDay, last.result, dayProfitLoss);
    const local = DateTime.fromISO(day, { zone: config.timezone });
    addToGroup(byWeekday, String(local.weekday), last.result, dayProfitLoss);
    addToGroup(byMonth, local.toFormat("yyyy-MM"), last.result, dayProfitLoss);
  }

  const wins = dailyResults.filter((d) => d.result === "win").length;
  const losses = dailyResults.filter((d) => d.result === "loss").length;
  const ties = dailyResults.filter((d) => d.result === "tie").length;
  const totalDays = dailyResults.length;

  const grossProfit = dailyResults
    .filter((d) => d.result === "win")
    .reduce((acc, d) => acc.plus(d.profitLoss), new Decimal(0));
  const grossLoss = dailyResults
    .filter((d) => d.result === "loss")
    .reduce((acc, d) => acc.plus(new Decimal(d.profitLoss).abs()), new Decimal(0));

  let maxWinStreakDays = 0;
  let maxLossStreakDays = 0;
  let winStreak = 0;
  let lossStreak = 0;
  for (const d of dailyResults) {
    if (d.result === "win") {
      winStreak += 1;
      lossStreak = 0;
    } else if (d.result === "loss") {
      lossStreak += 1;
      winStreak = 0;
    } else {
      winStreak = 0;
      lossStreak = 0;
    }
    maxWinStreakDays = Math.max(maxWinStreakDays, winStreak);
    maxLossStreakDays = Math.max(maxLossStreakDays, lossStreak);
  }

  const returnPct = config.initialBankroll.gt(0)
    ? bankroll.minus(config.initialBankroll).div(config.initialBankroll).mul(100).toFixed(2)
    : "0.00";

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
      byMartingaleLevel,
      totalDays,
      dailyWinPct: totalDays > 0 ? new Decimal(wins).div(totalDays).mul(100).toFixed(2) : "0.00",
      dailyLossPct: totalDays > 0 ? new Decimal(losses).div(totalDays).mul(100).toFixed(2) : "0.00",
      fullMartingaleLosses: losses,
      maxWinStreakDays,
      maxLossStreakDays,
      returnPct,
      dailyResults,
    },
  };
}

/**
 * Motor de análise estatística de padrões por horário.
 *
 * Para um par + timeframe + horário fixo (ex: EUR/USD, 5m, 12:00), olhamos a
 * direção do candle que COMEÇOU naquele horário em cada dia do período
 * analisado, e medimos a repetição da direção predominante.
 *
 * Importante: o agrupamento por "horário" é feito no timezone escolhido pelo
 * usuário, NUNCA em UTC diretamente — os candles são armazenados em UTC, mas
 * convertidos para o timezone da análise antes de agrupar.
 */
import { Decimal } from "decimal.js";
import { DateTime } from "luxon";
import { Candle, Direction, DojiPolicy, classifyCandle } from "./candle-classifier";

export enum PatternStatus {
  STRONG_ACTIVE = "forte_e_ativo",
  ACTIVE = "ativo",
  WEAKENING = "perdendo_forca",
  INACTIVE = "inativo",
  INSUFFICIENT_SAMPLE = "amostra_insuficiente",
}

export interface DailyOccurrence {
  day: string; // ISO date (yyyy-MM-dd), no timezone da análise
  direction: Direction;
}

export interface TimeOfDay {
  hour: number;
  minute: number;
}

export interface PatternResult {
  symbol: string;
  timeframe: string;
  timeOfDay: TimeOfDay;
  timezone: string;
  totalDaysAnalyzed: number;
  totalValid: number;
  callCount: number;
  putCount: number;
  dojiCount: number;
  predominantDirection: Direction | null;
  repetitionPct: Decimal;
  recent5Pct: Decimal | null;
  recent10Pct: Decimal | null;
  recent20PctPeriodPct: Decimal | null;
  currentStreak: number; // positivo = acertando, negativo = errando
  lastOccurrenceDate: string | null;
  daysSinceLastOccurrence: number | null;
  status: PatternStatus;
  confidenceNote: string;
  occurrences: DailyOccurrence[];
}

export function suggestedEntryDirection(
  result: PatternResult,
  contrarian: boolean
): Direction | null {
  if (result.predominantDirection === null) return null;
  if (!contrarian) return result.predominantDirection;
  return result.predominantDirection === Direction.CALL ? Direction.PUT : Direction.CALL;
}

/** Regras transparentes e configuráveis para classificar o status do padrão. */
export interface StatusThresholds {
  minValidOccurrences: number;
  strongActiveMinPct: Decimal;
  strongActiveMinRecent10Pct: Decimal;
  activeMinPct: Decimal;
  activeMinRecent10Pct: Decimal;
  weakeningRecent10DropPct: Decimal;
}

export const DEFAULT_STATUS_THRESHOLDS: StatusThresholds = {
  minValidOccurrences: 20,
  strongActiveMinPct: new Decimal(75),
  strongActiveMinRecent10Pct: new Decimal(70),
  activeMinPct: new Decimal(65),
  activeMinRecent10Pct: new Decimal(55),
  weakeningRecent10DropPct: new Decimal(15),
};

export interface AnalyzeTimeSlotParams {
  candles: Candle[];
  symbol: string;
  timeframe: string;
  targetTime: TimeOfDay;
  timezone: string;
  dojiTolerancePct: Decimal;
  dojiPolicy: DojiPolicy;
  weekdays?: Set<number>; // luxon: 1=segunda ... 7=domingo; undefined = todos
  thresholds?: StatusThresholds;
}

export function analyzeTimeSlot(params: AnalyzeTimeSlotParams): PatternResult {
  const {
    candles,
    symbol,
    timeframe,
    targetTime,
    timezone,
    dojiTolerancePct,
    dojiPolicy,
    weekdays,
    thresholds = DEFAULT_STATUS_THRESHOLDS,
  } = params;

  // 1) localizar candles que abrem exatamente no horário-alvo, no timezone escolhido
  const byDay = new Map<string, Direction>();
  for (const c of candles) {
    if (c.symbol !== symbol || c.timeframe !== timeframe) continue;
    const localOpen = DateTime.fromJSDate(c.openTime, { zone: "utc" }).setZone(timezone);
    if (localOpen.hour !== targetTime.hour || localOpen.minute !== targetTime.minute) continue;
    if (weekdays && !weekdays.has(localOpen.weekday)) continue;
    const direction = classifyCandle(c, dojiTolerancePct);
    byDay.set(localOpen.toISODate()!, direction);
  }

  const occurrences: DailyOccurrence[] = Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, direction]) => ({ day, direction }));

  const totalDaysAnalyzed = occurrences.length;
  const directionsOnly = occurrences.map((o) => o.direction);
  const callCount = directionsOnly.filter((d) => d === Direction.CALL).length;
  const putCount = directionsOnly.filter((d) => d === Direction.PUT).length;
  const dojiCount = directionsOnly.filter((d) => d === Direction.DOJI).length;

  const totalValid =
    dojiPolicy === DojiPolicy.IGNORE ? callCount + putCount : directionsOnly.length;

  if (totalValid === 0) {
    return {
      symbol,
      timeframe,
      timeOfDay: targetTime,
      timezone,
      totalDaysAnalyzed,
      totalValid: 0,
      callCount,
      putCount,
      dojiCount,
      predominantDirection: null,
      repetitionPct: new Decimal(0),
      recent5Pct: null,
      recent10Pct: null,
      recent20PctPeriodPct: null,
      currentStreak: 0,
      lastOccurrenceDate: null,
      daysSinceLastOccurrence: null,
      status: PatternStatus.INSUFFICIENT_SAMPLE,
      confidenceNote: "Nenhuma ocorrência válida no período.",
      occurrences,
    };
  }

  const predominant = callCount >= putCount ? Direction.CALL : Direction.PUT;
  const predominantCount = Math.max(callCount, putCount);
  const repetitionPct = new Decimal(predominantCount).div(totalValid).mul(100);

  const pctPredominant = (occs: DailyOccurrence[]): Decimal | null => {
    const relevant =
      dojiPolicy === DojiPolicy.IGNORE ? occs.filter((o) => o.direction !== Direction.DOJI) : occs;
    if (relevant.length === 0) return null;
    const hits = relevant.filter((o) => o.direction === predominant).length;
    return new Decimal(hits).div(relevant.length).mul(100);
  };

  const recent5Pct = pctPredominant(occurrences.slice(-5));
  const recent10Pct = pctPredominant(occurrences.slice(-10));
  const last20PctN = Math.max(1, Math.round(totalDaysAnalyzed * 0.2));
  const recent20PctPeriodPct = pctPredominant(occurrences.slice(-last20PctN));

  // sequência atual (streak) de acertos/erros da direção predominante
  let currentStreak = 0;
  for (let i = occurrences.length - 1; i >= 0; i--) {
    const o = occurrences[i];
    if (dojiPolicy === DojiPolicy.IGNORE && o.direction === Direction.DOJI) continue;
    const hit = o.direction === predominant;
    if (currentStreak === 0) {
      currentStreak = hit ? 1 : -1;
    } else if (currentStreak > 0 === hit) {
      currentStreak += hit ? 1 : -1;
    } else {
      break;
    }
  }

  // última ocorrência da direção predominante
  let lastOccurrenceDate: string | null = null;
  for (let i = occurrences.length - 1; i >= 0; i--) {
    if (occurrences[i].direction === predominant) {
      lastOccurrenceDate = occurrences[i].day;
      break;
    }
  }
  const daysSinceLastOccurrence =
    lastOccurrenceDate !== null
      ? Math.round(
          DateTime.fromISO(occurrences[occurrences.length - 1].day)
            .diff(DateTime.fromISO(lastOccurrenceDate), "days").days
        )
      : null;

  // status do padrão (regras configuráveis e transparentes)
  let status: PatternStatus;
  let note: string;

  if (totalValid < thresholds.minValidOccurrences) {
    status = PatternStatus.INSUFFICIENT_SAMPLE;
    note = `Amostra de ${totalValid} ocorrências abaixo do mínimo configurado (${thresholds.minValidOccurrences}). Percentuais altos com poucas ocorrências são pouco confiáveis.`;
  } else {
    const r10 = recent10Pct ?? new Decimal(0);
    const drop = repetitionPct.minus(r10);
    if (
      repetitionPct.gte(thresholds.strongActiveMinPct) &&
      r10.gte(thresholds.strongActiveMinRecent10Pct)
    ) {
      status = PatternStatus.STRONG_ACTIVE;
      note = "Percentual geral e recente ambos altos: padrão forte e ativo.";
    } else if (
      repetitionPct.gte(thresholds.activeMinPct) &&
      r10.gte(thresholds.activeMinRecent10Pct)
    ) {
      status = PatternStatus.ACTIVE;
      note = "Padrão dentro dos parâmetros de atividade.";
    } else if (drop.gte(thresholds.weakeningRecent10DropPct)) {
      status = PatternStatus.WEAKENING;
      note = `Percentual recente (10 dias) caiu ${drop.toFixed(1)} pontos em relação ao percentual geral: padrão perdendo força.`;
    } else {
      status = PatternStatus.INACTIVE;
      note = "Padrão não atende aos critérios mínimos de atividade recente.";
    }
  }

  return {
    symbol,
    timeframe,
    timeOfDay: targetTime,
    timezone,
    totalDaysAnalyzed,
    totalValid,
    callCount,
    putCount,
    dojiCount,
    predominantDirection: predominant,
    repetitionPct,
    recent5Pct,
    recent10Pct,
    recent20PctPeriodPct,
    currentStreak,
    lastOccurrenceDate,
    daysSinceLastOccurrence,
    status,
    confidenceNote: note,
    occurrences,
  };
}

export type RankSortBy = "repetitionPct" | "totalValid" | "recent10Pct";

export function rankPatterns(
  results: PatternResult[],
  options: { sortBy?: RankSortBy; minPct?: Decimal; onlyActive?: boolean; topN?: number } = {}
): PatternResult[] {
  const { sortBy = "repetitionPct", minPct, onlyActive, topN } = options;

  let filtered = results;
  if (minPct !== undefined) {
    filtered = filtered.filter((r) => r.repetitionPct.gte(minPct));
  }
  if (onlyActive) {
    filtered = filtered.filter(
      (r) => r.status === PatternStatus.STRONG_ACTIVE || r.status === PatternStatus.ACTIVE
    );
  }

  const keyFn: Record<RankSortBy, (r: PatternResult) => Decimal> = {
    repetitionPct: (r) => r.repetitionPct,
    totalValid: (r) => new Decimal(r.totalValid),
    recent10Pct: (r) => r.recent10Pct ?? new Decimal(-1),
  };

  const sorted = [...filtered].sort((a, b) => keyFn[sortBy](b).cmp(keyFn[sortBy](a)));
  return topN !== undefined ? sorted.slice(0, topN) : sorted;
}

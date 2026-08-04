/**
 * Orquestração de uma análise completa: recebe os candles já carregados
 * (de onde quer que venham) e devolve um PatternResult por
 * par + timeframe + horário.
 *
 * Esta camada é PURA de propósito — não conhece banco, request nem resposta
 * HTTP. O Route Handler carrega os candles via CandleDataProvider, chama
 * `runAnalysis` e persiste o resultado. Isso mantém o motor testável sem
 * banco (como já acontece em src/lib/core) e permite reaproveitá-lo no motor
 * de backtest da Fase 3.
 *
 * Os horários analisados NÃO são inventados: são exatamente os horários em que
 * existem candles no período, no timezone da análise, dentro da janela
 * configurada.
 */
import { Decimal } from "decimal.js";
import { DateTime } from "luxon";
import { Candle, DojiPolicy } from "@/lib/core/candle-classifier";
import {
  DEFAULT_STATUS_THRESHOLDS,
  PatternResult,
  TimeOfDay,
  analyzeTimeSlot,
  rankPatterns,
} from "@/lib/core/pattern-analyzer";

export interface AnalysisRunConfig {
  timeframe: string;
  timezone: string;
  /** Janela de horários "HH:mm" no timezone acima (inclusive). */
  startTime?: string | null;
  endTime?: string | null;
  /** Dias da semana no padrão luxon (1=segunda ... 7=domingo). null/undefined = todos. */
  weekdays?: number[] | null;
  dojiTolerancePct: Decimal;
  dojiPolicy: DojiPolicy;
  /** Descarta do resultado os padrões abaixo deste percentual de repetição. */
  minRepetitionPct: Decimal;
  /** Mínimo de ocorrências válidas para o padrão não ser "amostra_insuficiente". */
  minValidDays: number;
  /** Mantém apenas os N horários com maior repetitionPct (ranking único, entre todos os pares da análise). */
  topN?: number;
}

export function parseTimeOfDay(value: string): TimeOfDay {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new Error(`Horário inválido (esperado "HH:mm"): ${value}`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function formatTimeOfDay(time: TimeOfDay): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function minutesOf(time: TimeOfDay): number {
  return time.hour * 60 + time.minute;
}

/**
 * Janela de horários inclusiva nas duas pontas. Se `endTime` for menor que
 * `startTime`, a janela é interpretada como atravessando a meia-noite
 * (ex: 22:00 → 02:00), caso comum em sessões de mercado.
 */
function isWithinWindow(
  time: TimeOfDay,
  startTime?: string | null,
  endTime?: string | null
): boolean {
  if (!startTime && !endTime) return true;
  const current = minutesOf(time);
  const start = startTime ? minutesOf(parseTimeOfDay(startTime)) : 0;
  const end = endTime ? minutesOf(parseTimeOfDay(endTime)) : 24 * 60 - 1;

  return start <= end
    ? current >= start && current <= end
    : current >= start || current <= end;
}

/**
 * Analisa todos os pares/horários presentes nos candles fornecidos.
 * O resultado já vem filtrado por `minRepetitionPct` e ordenado por
 * percentual de repetição (mesma regra de `rankPatterns`).
 */
export function runAnalysis(candles: Candle[], config: AnalysisRunConfig): PatternResult[] {
  const relevant = candles.filter((c) => c.timeframe === config.timeframe);
  const weekdaySet =
    config.weekdays && config.weekdays.length > 0 ? new Set(config.weekdays) : undefined;

  // 1) descobrir os pares (symbol, horário) que realmente existem no período
  const slotsBySymbol = new Map<string, Map<string, TimeOfDay>>();
  for (const candle of relevant) {
    const local = DateTime.fromJSDate(candle.openTime, { zone: "utc" }).setZone(config.timezone);
    if (weekdaySet && !weekdaySet.has(local.weekday)) continue;

    const time: TimeOfDay = { hour: local.hour, minute: local.minute };
    if (!isWithinWindow(time, config.startTime, config.endTime)) continue;

    let slots = slotsBySymbol.get(candle.symbol);
    if (!slots) {
      slots = new Map<string, TimeOfDay>();
      slotsBySymbol.set(candle.symbol, slots);
    }
    slots.set(formatTimeOfDay(time), time);
  }

  // 2) rodar o motor estatístico para cada combinação encontrada
  const thresholds = {
    ...DEFAULT_STATUS_THRESHOLDS,
    minValidOccurrences: config.minValidDays,
  };

  const results: PatternResult[] = [];
  for (const [symbol, slots] of slotsBySymbol) {
    const symbolCandles = relevant.filter((c) => c.symbol === symbol);
    for (const time of slots.values()) {
      results.push(
        analyzeTimeSlot({
          candles: symbolCandles,
          symbol,
          timeframe: config.timeframe,
          targetTime: time,
          timezone: config.timezone,
          dojiTolerancePct: config.dojiTolerancePct,
          dojiPolicy: config.dojiPolicy,
          weekdays: weekdaySet,
          thresholds,
        })
      );
    }
  }

  return rankPatterns(results, {
    sortBy: "repetitionPct",
    minPct: config.minRepetitionPct,
    topN: config.topN,
  });
}

/**
 * Conversão de `openTime` (UTC) para hora local, com memoização por candle.
 *
 * `DateTime.fromJSDate(...).setZone(...)` do Luxon não é barato — o motor de
 * backtest chama isso para os MESMOS candles repetidamente (uma vez por
 * horário candidato, por dia simulado, já que `analyzeAllSlots`/
 * `analyzeTimeSlot` recalculam do zero a cada dia). Sem cache, um backtest de
 * poucas semanas já significa milhões de conversões redundantes — chegou a
 * levar quase 20 minutos num teste real antes desse cache existir.
 *
 * A hora local de um candle num timezone fixo nunca muda entre chamadas, então
 * cachear por (candle, timezone) é seguro e turns O(dias × horários × candles)
 * em O(candles) de conversão de fato.
 */
import { DateTime } from "luxon";

export interface LocalTime {
  hour: number;
  minute: number;
  weekday: number; // luxon: 1=segunda ... 7=domingo
  dateISO: string; // yyyy-MM-dd no timezone informado
}

const cache = new WeakMap<object, Map<string, LocalTime>>();

export function localTimeOf(candle: { openTime: Date }, timezone: string): LocalTime {
  let byTimezone = cache.get(candle);
  if (!byTimezone) {
    byTimezone = new Map();
    cache.set(candle, byTimezone);
  }

  const cached = byTimezone.get(timezone);
  if (cached) return cached;

  const dt = DateTime.fromJSDate(candle.openTime, { zone: "utc" }).setZone(timezone);
  const result: LocalTime = { hour: dt.hour, minute: dt.minute, weekday: dt.weekday, dateISO: dt.toISODate()! };
  byTimezone.set(timezone, result);
  return result;
}

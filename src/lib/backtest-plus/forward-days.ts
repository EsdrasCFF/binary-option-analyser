/**
 * Descoberta dos dias de negociação futuros válidos para o Backtest Plus
 * (seção 6). "Válido" aqui significa **existe candle real carregado para
 * aquele dia** — não é um D+1 de calendário ingênuo. Isso faz finais de
 * semana (sem candle forex) e buracos de dado serem naturalmente pulados,
 * sem fabricar um dia 0/N artificial para eles (proibido pela seção 6/49).
 *
 * Puro: recebe candles já carregados (mesma fonte única `DbCandleProvider`
 * usada em todo o resto do projeto) e devolve só as datas — não conhece
 * modelos de seleção nem resultados de entrada.
 */
import { DateTime } from "luxon";
import type { Candle } from "@/lib/core/candle-classifier";
import { localTimeOf } from "@/lib/core/local-time";

// Limite de segurança contra datasets com buracos enormes (ex: par sem
// candle novo há meses) — nunca deveria ser atingido num uso normal, onde
// alguns dias de calendário à frente já bastam para achar os dias pedidos
// (no máximo 5). Evita loop efetivamente infinito num cenário de dado ruim.
const MAX_FORWARD_SCAN_DAYS = 60;

/**
 * Retorna, em ordem crescente, as datas (yyyy-MM-dd no timezone informado)
 * dos próximos `forwardDaysRequested` dias — a partir do dia seguinte a
 * `referenceDate` — para os quais existe pelo menos 1 candle carregado.
 *
 * Pode devolver menos que `forwardDaysRequested` datas se o scan atingir
 * `MAX_FORWARD_SCAN_DAYS` sem achar candle suficiente — o chamador decide
 * como reportar isso (nunca preenche com um dia fictício).
 */
export function findForwardValidDays(
  candles: Candle[],
  referenceDate: Date,
  timezone: string,
  forwardDaysRequested: number
): string[] {
  const daysWithData = new Set<string>();
  for (const c of candles) {
    daysWithData.add(localTimeOf(c, timezone).dateISO);
  }

  const referenceLocalDay = DateTime.fromJSDate(referenceDate, { zone: "utc" }).setZone(timezone).startOf("day");

  const found: string[] = [];
  for (let offset = 1; offset <= MAX_FORWARD_SCAN_DAYS && found.length < forwardDaysRequested; offset++) {
    const candidateDay = referenceLocalDay.plus({ days: offset }).toISODate()!;
    if (daysWithData.has(candidateDay)) found.push(candidateDay);
  }

  return found;
}

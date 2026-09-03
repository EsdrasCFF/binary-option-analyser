/**
 * Heurísticas de diversificação usadas pelo modelo DIVERSIFIED (seção 29).
 *
 * É uma penalização simples e auditável sobre o Confidence Score já
 * calculado pela Análise Plus — NÃO é machine learning, NÃO afirma
 * correlação estatística comprovada entre pares, e NUNCA recalcula ou
 * altera o Confidence Score original (isso continua sendo propriedade
 * exclusiva de `multi-period-scoring.ts`). O modelo continua primariamente
 * guiado por score; a diversificação só desempata/ajusta a escolha entre
 * candidatos concentrados nas mesmas moedas ou horários muito próximos.
 */
import type { PoolCandidate } from "./types";

export interface DiversificationConfig {
  /** Penalização (pontos de score) por CADA moeda (base ou quote) que o candidato compartilha com uma entrada já selecionada no mesmo dia. */
  currencyOverlapPenaltyPerShare: number;
  /** Distância mínima (minutos) entre horários para NÃO sofrer penalização de proximidade. */
  closeTimeThresholdMinutes: number;
  /** Penalização (pontos de score) quando o horário cai dentro do threshold de proximidade de uma entrada já selecionada. */
  closeTimePenalty: number;
}

// Valores iniciais conservadores — não havia nenhuma configuração de
// diversificação prévia no projeto para reaproveitar. Penalizações pequenas
// o bastante para não dominarem o Confidence Score (que varia 0-100), documentadas
// aqui para eventual recalibração futura (não usadas em nenhum outro lugar).
export const DEFAULT_DIVERSIFICATION_CONFIG: DiversificationConfig = {
  currencyOverlapPenaltyPerShare: 4,
  closeTimeThresholdMinutes: 30,
  closeTimePenalty: 3,
};

/** "EUR/USD" -> {base: "EUR", quote: "USD"}. Símbolo fora do padrão retorna quote vazio, sem lançar. */
export function extractCurrencies(symbol: string): { base: string; quote: string } {
  const [base, quote] = symbol.split("/");
  return { base: base ?? symbol, quote: quote ?? "" };
}

/** Diferença absoluta em minutos entre dois horários "HH:mm" — comparação literal de relógio, não usa timezone (os horários já vêm no timezone congelado da análise de origem). */
export function minutesBetween(a: string, b: string): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  return Math.abs(toMinutes(a) - toMinutes(b));
}

/** Para cada entrada já selecionada, soma 1 ponto se a base do candidato aparece nela, +1 se a quote aparece — resultado acumulado ao longo de todas as entradas já selecionadas no dia. */
function sharedCurrencyCount(candidate: PoolCandidate, selected: PoolCandidate[]): number {
  const { base, quote } = extractCurrencies(candidate.symbol);
  let shared = 0;
  for (const s of selected) {
    const other = extractCurrencies(s.symbol);
    const otherCurrencies = new Set([other.base, other.quote]);
    if (otherCurrencies.has(base)) shared++;
    if (otherCurrencies.has(quote)) shared++;
  }
  return shared;
}

/** Quantas entradas já selecionadas têm horário "próximo demais" (dentro do threshold) do candidato. */
function closeTimeCount(candidate: PoolCandidate, selected: PoolCandidate[], config: DiversificationConfig): number {
  let count = 0;
  for (const s of selected) {
    if (minutesBetween(candidate.timeOfDay, s.timeOfDay) < config.closeTimeThresholdMinutes) count++;
  }
  return count;
}

/** Score ajustado = Confidence Score original - penalização de sobreposição de moeda - penalização de proximidade de horário. Só usado para ORDENAR a escolha do modelo DIVERSIFIED — nunca persistido nem exibido como se fosse o Confidence Score real. */
export function computeAdjustedScore(
  candidate: PoolCandidate,
  selected: PoolCandidate[],
  config: DiversificationConfig = DEFAULT_DIVERSIFICATION_CONFIG
): number {
  const overlapPenalty = sharedCurrencyCount(candidate, selected) * config.currencyOverlapPenaltyPerShare;
  const timePenalty = closeTimeCount(candidate, selected, config) * config.closeTimePenalty;
  return candidate.confidenceScore - overlapPenalty - timePenalty;
}

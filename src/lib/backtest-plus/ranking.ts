/**
 * Ranking do placar comparativo dos 5 modelos (seção 43). O objetivo
 * primário do Backtest Plus é MINIMIZAR dias 0/N, não maximizar vitórias
 * totais — por isso o critério primário de ordenação é `zeroOfNRate`
 * (menor primeiro), nunca `totalWins`.
 *
 * Ordem de desempate (5 níveis), do mais para o menos importante:
 *   1. Menor zeroOfNRate (critério primário: menos dias de "todas as
 *      entradas perderam").
 *   2. Maior dailySuccessRate (pode divergir do complemento de zeroOfNRate
 *      quando `daysExcludedNoData` difere entre modelos).
 *   3. Maior individualHitRate (qualidade das entradas individuais).
 *   4. Menor averageEntriesUntilFirstWin (quando existir; modelo sem
 *      nenhum dia com vitória — `null` — fica sempre depois de quem tem
 *      valor, já que não há base pra comparar "quão rápido" venceu).
 *   5. Maior totalWins (desempate final, o critério de menor peso).
 *
 * Determinístico: se todos os 5 níveis empatarem, a ordem de entrada
 * (`BACKTEST_PLUS_MODEL_TYPES`) é preservada (sort estável).
 */
import type { ModelMetrics } from "./metrics";
import type { BacktestPlusModelType } from "./types";

export interface RankableModel {
  model: BacktestPlusModelType;
  metrics: ModelMetrics;
}

function compareAverageUntilFirstWin(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // a sem vitória alguma: pior, vai depois
  if (b === null) return -1;
  return a - b; // menor é melhor
}

/** Compara dois modelos pelo critério de melhor Backtest Plus (seção 43). Retorna negativo se `a` é melhor que `b`. */
export function compareModels(a: RankableModel, b: RankableModel): number {
  const m = a.metrics;
  const n = b.metrics;
  return (
    m.zeroOfNRate - n.zeroOfNRate ||
    n.dailySuccessRate - m.dailySuccessRate ||
    n.individualHitRate - m.individualHitRate ||
    compareAverageUntilFirstWin(m.averageEntriesUntilFirstWin, n.averageEntriesUntilFirstWin) ||
    n.totalWins - m.totalWins
  );
}

/** Ordena os modelos do melhor para o pior — usado no placar comparativo da UI. Não muta o array recebido. */
export function rankModels<T extends RankableModel>(models: T[]): T[] {
  return [...models].sort(compareModels);
}

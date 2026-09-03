/**
 * Tipos compartilhados do Backtest Plus. Strings mágicas evitadas em favor
 * destes union types — seção 28 do briefing.
 */

export type BacktestPlusModelType = "top_score" | "random" | "rotation" | "weighted_score" | "diversified";

export const BACKTEST_PLUS_MODEL_TYPES: readonly BacktestPlusModelType[] = [
  "top_score",
  "random",
  "rotation",
  "weighted_score",
  "diversified",
];

/** Nomes amigáveis em português pra UI (seção 42) — os enums internos ficam em inglês. */
export const BACKTEST_PLUS_MODEL_LABELS: Record<BacktestPlusModelType, string> = {
  top_score: "Top Score",
  random: "Aleatório",
  rotation: "Rotação",
  weighted_score: "Ponderado",
  diversified: "Diversificado",
};

/** Resultado de uma entrada — WIN/LOSS/TIE (mesmo vocabulário 3-estados já usado em `backtestOperations`/`bankrollLedgerEntries`) + INVALID (seção 10: candle ausente ou DOJI sob política IGNORE). */
export type BacktestPlusEntryResult = "win" | "loss" | "tie" | "invalid";

/** Motivo de uma entrada INVALID — nunca vira LOSS silenciosamente (seção 10/49). */
export type BacktestPlusInvalidReason = "no_data" | "doji";

/**
 * Um candidato do pool de 10 — já é o SNAPSHOT congelado da Análise Plus
 * (seção 2/15), não uma referência viva. `poolRank` preserva a ordem
 * original de seleção/ranking e serve de desempate determinístico em vários
 * modelos.
 */
export interface PoolCandidate {
  id: string;
  symbol: string;
  timeOfDay: string; // "HH:mm", no timezone da análise de origem
  direction: "CALL" | "PUT";
  confidenceScore: number;
  poolRank: number; // 0-9
}

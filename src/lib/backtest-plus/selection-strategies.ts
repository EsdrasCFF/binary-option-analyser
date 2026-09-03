/**
 * Os 5 modelos de seleção de candidatos do Backtest Plus (seção 7). Cada
 * modelo recebe o MESMO pool congelado de 10 candidatos e escolhe N deles
 * (4 ou 5) para um dia — nunca altera o pool, nunca recalcula score.
 *
 * Fronteira explícita (seção 26/27): esta função só ESCOLHE candidatos.
 * Resolver WIN/LOSS/TIE/INVALID contra as candles é responsabilidade de
 * `resolve-entries.ts`; agregar métricas é responsabilidade de
 * `metrics.ts`. Este módulo não conhece candles nem resultados.
 */
import { randomInt, type SeededRandom } from "./seeded-random";
import type { BacktestPlusModelType, PoolCandidate } from "./types";
import { computeAdjustedScore, DEFAULT_DIVERSIFICATION_CONFIG, type DiversificationConfig } from "./diversification";

/** Config do modelo WEIGHTED_SCORE (seção 7, modelo 4). */
export interface WeightedScoreConfig {
  /** Constante somada a (score - menorScoreDoPool) para nenhum candidato ficar com peso zero, nem o de menor score do pool. */
  weightOffset: number;
}

export const DEFAULT_WEIGHTED_SCORE_CONFIG: WeightedScoreConfig = { weightOffset: 5 };

export interface SelectionContext {
  /** Gerador seeded — usado por RANDOM e WEIGHTED_SCORE. Ignorado pelos demais modelos. */
  rng: SeededRandom;
  /** ROTATION: quantas vezes cada candidato (por `id`) já foi usado no backtest até este dia — o orquestrador atualiza este mapa depois de cada dia processado. */
  usageCount: Map<string, number>;
  weightedScoreConfig?: WeightedScoreConfig;
  diversificationConfig?: DiversificationConfig;
}

function byPoolRank(a: PoolCandidate, b: PoolCandidate): number {
  return a.poolRank - b.poolRank;
}

/** TOP_SCORE — determinístico, sem aleatoriedade, grupo de controle (seção 7, modelo 1). Empate: menor poolRank primeiro. */
function selectTopScore(candidates: PoolCandidate[], count: number): PoolCandidate[] {
  return [...candidates].sort((a, b) => b.confidenceScore - a.confidenceScore || byPoolRank(a, b)).slice(0, count);
}

/** RANDOM — seeded, sem repetição dentro do mesmo dia (seção 7, modelo 2). */
function selectRandom(candidates: PoolCandidate[], count: number, rng: SeededRandom): PoolCandidate[] {
  const pool = [...candidates];
  const selected: PoolCandidate[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = randomInt(rng, pool.length);
    selected.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return selected;
}

/** ROTATION — prioriza quem foi menos usado até agora; empate por maior score; empate final por poolRank (seção 7, modelo 3). Totalmente determinístico. */
function selectRotation(candidates: PoolCandidate[], count: number, usageCount: Map<string, number>): PoolCandidate[] {
  return [...candidates]
    .sort((a, b) => {
      const usageA = usageCount.get(a.id) ?? 0;
      const usageB = usageCount.get(b.id) ?? 0;
      if (usageA !== usageB) return usageA - usageB;
      if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
      return byPoolRank(a, b);
    })
    .slice(0, count);
}

/** WEIGHTED_SCORE — amostragem ponderada seeded, sem reposição; peso = score normalizado, NUNCA interpretado como probabilidade de vitória (seção 7, modelo 4 / seção 25). */
function selectWeightedScore(
  candidates: PoolCandidate[],
  count: number,
  rng: SeededRandom,
  config: WeightedScoreConfig
): PoolCandidate[] {
  const minScore = Math.min(...candidates.map((c) => c.confidenceScore));
  const pool = candidates.map((c) => ({ candidate: c, weight: c.confidenceScore - minScore + config.weightOffset }));
  const selected: PoolCandidate[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const totalWeight = pool.reduce((acc, p) => acc + p.weight, 0);
    let r = rng() * totalWeight;
    let chosenIndex = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      r -= pool[j].weight;
      if (r <= 0) {
        chosenIndex = j;
        break;
      }
    }
    selected.push(pool[chosenIndex].candidate);
    pool.splice(chosenIndex, 1);
  }
  return selected;
}

/** DIVERSIFIED — guloso, ainda primariamente guiado por score, penaliza sobreposição de moeda e proximidade de horário; totalmente determinístico (seção 7, modelo 5 / seção 29). Sem ML, sem otimização combinatória complexa — é uma heurística gulosa simples e auditável. */
function selectDiversified(candidates: PoolCandidate[], count: number, config: DiversificationConfig): PoolCandidate[] {
  const remaining = [...candidates];
  const selected: PoolCandidate[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let j = 0; j < remaining.length; j++) {
      const adjusted = computeAdjustedScore(remaining[j], selected, config);
      if (adjusted > bestScore || (adjusted === bestScore && remaining[j].poolRank < remaining[bestIdx].poolRank)) {
        bestScore = adjusted;
        bestIdx = j;
      }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}

/**
 * Ponto único de entrada para os 5 modelos (seção 26/27 — separar
 * "selection strategy" de "backtest execution engine"). Sempre seleciona
 * `count` candidatos DENTRO do `candidates` recebido, sem mutar o array
 * original nem o pool congelado.
 */
export function selectCandidates(
  strategy: BacktestPlusModelType,
  candidates: PoolCandidate[],
  count: number,
  context: SelectionContext
): PoolCandidate[] {
  switch (strategy) {
    case "top_score":
      return selectTopScore(candidates, count);
    case "random":
      return selectRandom(candidates, count, context.rng);
    case "rotation":
      return selectRotation(candidates, count, context.usageCount);
    case "weighted_score":
      return selectWeightedScore(candidates, count, context.rng, context.weightedScoreConfig ?? DEFAULT_WEIGHTED_SCORE_CONFIG);
    case "diversified":
      return selectDiversified(candidates, count, context.diversificationConfig ?? DEFAULT_DIVERSIFICATION_CONFIG);
  }
}

/**
 * Agregação de métricas por modelo (seção 12/13). Recebe apenas os
 * RESULTADOS já resolvidos (WIN/LOSS/TIE/INVALID) de cada entrada de cada
 * dia — não conhece candles nem estratégias de seleção.
 *
 * Decisão documentada sobre INVALID no denominador (seção 13 pede
 * explicitamente para não esconder ausência de dados, mas não fixa uma
 * fórmula exata): um dia em que TODAS as N entradas selecionadas para
 * aquele modelo são INVALID não carrega nenhum sinal (não sabemos se teria
 * sido vitória ou derrota) e por isso é excluído do denominador das taxas
 * (`dailySuccessRate`/`zeroOfNRate`) — não é contado nem como dia de
 * sucesso, nem como 0/N. Esse dia continua contado em `daysTested` (é um
 * dia válido de negociação, com candle disponível para o par/timeframe em
 * geral) e é reportado separadamente em `daysExcludedNoData`, para nunca
 * mascarar silenciosamente a ausência de dado. Um dia com uma MISTURA de
 * INVALID e WIN/LOSS/TIE continua contando normalmente — as entradas
 * inválidas simplesmente não participam de win/loss/individualHitRate nem
 * de firstWinAt.
 */
import type { BacktestPlusEntryResult } from "./types";

export interface EntryOutcome {
  entryOrder: number; // 1-based, posição da entrada dentro do dia
  result: BacktestPlusEntryResult;
}

export interface DayOutcome {
  date: string; // yyyy-MM-dd
  entries: EntryOutcome[]; // já ordenadas por entryOrder
}

export interface ModelMetrics {
  daysTested: number;
  /** daysTested menos os dias totalmente INVALID (sem nenhum sinal aproveitável) — ver comentário do arquivo. */
  daysConsidered: number;
  daysExcludedNoData: number;
  successfulDays: number;
  failedDays: number;
  zeroOfN: number;
  dailySuccessRate: number; // 0-1, sobre daysConsidered
  zeroOfNRate: number; // 0-1, sobre daysConsidered
  totalEntries: number;
  totalWins: number;
  totalLosses: number;
  totalTies: number;
  invalidEntries: number;
  individualHitRate: number; // 0-1, wins / (wins + losses) — exclui TIE e INVALID do denominador
  averageEntriesUntilFirstWin: number | null; // só sobre dias com pelo menos 1 win
  medianEntriesUntilFirstWin: number | null;
  /** índice 0 = posição 1, índice (entriesPerDay-1) = última posição. */
  firstWinAt: number[];
  /** percentual acumulado (0-1) de dias cujo primeiro win ocorreu até a posição k+1 — monotônico não-decrescente. */
  coverageAt: number[];
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function aggregateMetrics(days: DayOutcome[], entriesPerDay: number): ModelMetrics {
  const daysTested = days.length;
  let successfulDays = 0;
  let daysExcludedNoData = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalTies = 0;
  let invalidEntries = 0;
  const firstWinAt = new Array(entriesPerDay).fill(0) as number[];
  const daysWithFirstWinPos: number[] = [];

  for (const day of days) {
    let firstWinPos: number | null = null;
    let validEntryCount = 0;
    for (const entry of day.entries) {
      if (entry.result === "invalid") {
        invalidEntries++;
        continue;
      }
      validEntryCount++;
      if (entry.result === "win") {
        totalWins++;
        if (firstWinPos === null) firstWinPos = entry.entryOrder;
      } else if (entry.result === "loss") {
        totalLosses++;
      } else {
        totalTies++;
      }
    }

    if (validEntryCount === 0) {
      daysExcludedNoData++;
      continue; // sem sinal algum neste dia — não entra em successfulDays/failedDays
    }

    if (firstWinPos !== null) {
      successfulDays++;
      firstWinAt[firstWinPos - 1]++;
      daysWithFirstWinPos.push(firstWinPos);
    }
  }

  const daysConsidered = daysTested - daysExcludedNoData;
  const failedDays = daysConsidered - successfulDays;
  const dailySuccessRate = daysConsidered > 0 ? successfulDays / daysConsidered : 0;
  const zeroOfNRate = daysConsidered > 0 ? failedDays / daysConsidered : 0;
  const totalEntries = totalWins + totalLosses + totalTies + invalidEntries;
  const individualHitRate = totalWins + totalLosses > 0 ? totalWins / (totalWins + totalLosses) : 0;

  const coverageAt = new Array(entriesPerDay).fill(0) as number[];
  for (let k = 0; k < entriesPerDay; k++) {
    const countUpToK = daysWithFirstWinPos.filter((p) => p <= k + 1).length;
    coverageAt[k] = daysConsidered > 0 ? countUpToK / daysConsidered : 0;
  }

  const sortedPositions = [...daysWithFirstWinPos].sort((a, b) => a - b);
  const averageEntriesUntilFirstWin =
    sortedPositions.length > 0 ? sortedPositions.reduce((a, b) => a + b, 0) / sortedPositions.length : null;
  const medianEntriesUntilFirstWin = sortedPositions.length > 0 ? median(sortedPositions) : null;

  return {
    daysTested,
    daysConsidered,
    daysExcludedNoData,
    successfulDays,
    failedDays,
    zeroOfN: failedDays,
    dailySuccessRate,
    zeroOfNRate,
    totalEntries,
    totalWins,
    totalLosses,
    totalTies,
    invalidEntries,
    individualHitRate,
    averageEntriesUntilFirstWin,
    medianEntriesUntilFirstWin,
    firstWinAt,
    coverageAt,
  };
}

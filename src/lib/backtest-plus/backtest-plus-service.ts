/**
 * Serviço de execução de um Backtest Plus já persistido — mesmo papel que
 * `backtest-service.ts` cumpre para o Backtest de período único.
 *
 * Diferença estrutural chave (seção 2/15/31): aqui NADA sobre a Análise
 * Plus de origem é reconsultado durante o processamento — o pool de 10
 * candidatos já foi congelado em `backtestPlusCandidates` no momento da
 * criação (`toCandidateSnapshotRow`, usado pela rota POST). Este serviço só
 * lê esse snapshot, carrega candles FUTURAS (a partir da `referenceDate`
 * congelada) e roda o motor puro `runBacktestPlus`.
 */
import { randomInt as cryptoRandomInt } from "crypto";
import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  backtestPlus,
  backtestPlusCandidates,
  backtestPlusEntries,
  backtestPlusModels,
  multiPeriodAnalysisConfigurations,
  multiPeriodPatternResults,
} from "@/db/schema";
import { DojiPolicy } from "@/lib/core/candle-classifier";
import { DbCandleProvider } from "@/lib/db/candle-provider";
import { chunk } from "@/lib/api/http";
import { runBacktestPlus } from "./backtest-plus-engine";
import { findForwardValidDays } from "./forward-days";
import { rankModels } from "./ranking";
import type { PoolCandidate } from "./types";

const INSERT_CHUNK_SIZE = 200;
// Postgres integer é int32 assinado — mantém o seed sempre positivo e dentro do range.
const MAX_RANDOM_SEED = 2_147_483_647;

/** Entropia real, gerada UMA VEZ na criação do backtest — depois disso, todo reprocessamento usa o MESMO seed armazenado (nunca gera um novo). Ver `seeded-random.ts` para por que a seleção em si nunca usa Math.random(). */
export function generateRandomSeed(): number {
  return cryptoRandomInt(1, MAX_RANDOM_SEED);
}

/**
 * Snapshot de um `multiPeriodPatternResults` em uma linha de
 * `backtestPlusCandidates` — cópia de valores, nunca uma referência viva.
 * `poolRank` é a posição (0-9) na ordem em que o usuário selecionou os
 * candidatos na tela de criação, preservada para desempate determinístico
 * nos 5 modelos. `symbol` vem resolvido à parte pelo chamador (join com
 * `currencyPairs` — `multiPeriodPatternResults` só guarda `currencyPairId`).
 */
export function toCandidateSnapshotRow(
  backtestId: string,
  poolRank: number,
  symbol: string,
  result: typeof multiPeriodPatternResults.$inferSelect
): typeof backtestPlusCandidates.$inferInsert {
  return {
    backtestId,
    sourceResultId: result.id,
    poolRank,
    currencyPairId: result.currencyPairId,
    symbol,
    timeOfDay: result.timeOfDay,
    timeframe: result.timeframe,
    direction: result.direction,
    confidenceScore: result.confidenceScore,
    classification: result.classification,
    recommendation: result.recommendation,
    momentumTrend: result.momentumTrend,
    structuralAverage: result.structuralAverage,
  };
}

function toPoolCandidate(row: typeof backtestPlusCandidates.$inferSelect): PoolCandidate {
  return {
    id: row.id,
    symbol: row.symbol,
    timeOfDay: row.timeOfDay,
    direction: row.direction as "CALL" | "PUT",
    confidenceScore: row.confidenceScore,
    poolRank: row.poolRank,
  };
}

export interface ProcessBacktestPlusResult {
  backtestId: string;
  candlesLoaded: number;
  daysTested: number;
  bestModel: string;
}

export async function processBacktestPlus(backtestId: string): Promise<ProcessBacktestPlusResult> {
  const [record] = await db.select().from(backtestPlus).where(eq(backtestPlus.id, backtestId)).limit(1);
  if (!record) {
    throw new Error(`Backtest Plus ${backtestId} não encontrado.`);
  }

  await db
    .update(backtestPlus)
    .set({ status: "processing", progressPct: 10, errorMessage: null })
    .where(eq(backtestPlus.id, backtestId));

  try {
    const candidateRows = await db
      .select()
      .from(backtestPlusCandidates)
      .where(eq(backtestPlusCandidates.backtestId, backtestId))
      .orderBy(backtestPlusCandidates.poolRank);

    if (candidateRows.length !== 10) {
      throw new Error(`Pool de candidatos inconsistente: esperado 10, encontrado ${candidateRows.length}.`);
    }

    // escopo (timeframe/timezone/doji) vem da configuração da Análise Plus de
    // origem — só usado para saber COMO carregar/classificar candles futuras,
    // nunca para recalcular a análise em si.
    const [configuration] = await db
      .select()
      .from(multiPeriodAnalysisConfigurations)
      .where(eq(multiPeriodAnalysisConfigurations.analysisId, record.sourceAnalysisId))
      .limit(1);
    if (!configuration) {
      throw new Error("Não foi possível carregar a configuração da Análise Plus de origem.");
    }

    const pool = candidateRows.map(toPoolCandidate);
    const currencyPairIds = Array.from(new Set(candidateRows.map((c) => c.currencyPairId)));

    // sem `to`: carrega todo o histórico futuro disponível a partir da referenceDate
    // congelada — o próprio `findForwardValidDays` decide quais desses dias contam.
    const candles = await new DbCandleProvider({
      currencyPairIds,
      timeframe: configuration.timeframe,
      from: record.referenceDate,
    }).loadCandles();

    await db.update(backtestPlus).set({ progressPct: 30 }).where(eq(backtestPlus.id, backtestId));

    const forwardDays = findForwardValidDays(
      candles,
      record.referenceDate,
      configuration.timezone,
      record.forwardDaysRequested
    );

    if (forwardDays.length === 0) {
      throw new Error(
        `Nenhum candle encontrado após ${record.referenceDate.toISOString().slice(0, 10)} para o escopo desta Análise Plus (timeframe ${configuration.timeframe}). Importe dados mais recentes antes de criar o Backtest Plus.`
      );
    }

    await db.update(backtestPlus).set({ progressPct: 50 }).where(eq(backtestPlus.id, backtestId));

    const engineResult = runBacktestPlus({
      pool,
      entriesPerDay: record.entriesPerDay as 4 | 5,
      forwardDays,
      randomSeed: record.randomSeed,
      timeframe: configuration.timeframe,
      timezone: configuration.timezone,
      dojiTolerancePct: new Decimal(configuration.dojiTolerancePct),
      dojiPolicy: configuration.dojiPolicy as DojiPolicy,
      candles,
    });

    await db.update(backtestPlus).set({ progressPct: 75 }).where(eq(backtestPlus.id, backtestId));

    // reprocessar substitui modelos/entradas anteriores (mesmo padrão de processBacktest)
    const existingModels = await db
      .select({ id: backtestPlusModels.id })
      .from(backtestPlusModels)
      .where(eq(backtestPlusModels.backtestId, backtestId));
    if (existingModels.length > 0) {
      await db.delete(backtestPlusModels).where(eq(backtestPlusModels.backtestId, backtestId));
    }

    const ranked = rankModels(engineResult.models);
    const candidateById = new Map(candidateRows.map((c) => [c.id, c]));

    for (let rankPosition = 0; rankPosition < ranked.length; rankPosition++) {
      const modelRun = ranked[rankPosition];
      const m = modelRun.metrics;

      const [modelRow] = await db
        .insert(backtestPlusModels)
        .values({
          backtestId,
          modelType: modelRun.model,
          rankPosition: rankPosition + 1,
          daysTested: m.daysConsidered,
          successfulDays: m.successfulDays,
          failedDays: m.failedDays,
          dailySuccessRate: m.dailySuccessRate.toFixed(4),
          zeroOfNRate: m.zeroOfNRate.toFixed(4),
          totalEntries: m.totalEntries,
          totalWins: m.totalWins,
          totalLosses: m.totalLosses,
          totalTies: m.totalTies,
          invalidEntries: m.invalidEntries,
          individualHitRate: m.individualHitRate.toFixed(4),
          averageEntriesUntilFirstWin:
            m.averageEntriesUntilFirstWin === null ? null : m.averageEntriesUntilFirstWin.toFixed(3),
          medianEntriesUntilFirstWin:
            m.medianEntriesUntilFirstWin === null ? null : m.medianEntriesUntilFirstWin.toFixed(3),
          firstWinAt1: m.firstWinAt[0],
          firstWinAt2: m.firstWinAt[1],
          firstWinAt3: m.firstWinAt[2],
          firstWinAt4: m.firstWinAt[3],
          firstWinAt5: record.entriesPerDay === 5 ? m.firstWinAt[4] : null,
          zeroOfN: m.zeroOfN,
          coverageAt1: m.coverageAt[0].toFixed(4),
          coverageAt2: m.coverageAt[1].toFixed(4),
          coverageAt3: m.coverageAt[2].toFixed(4),
          coverageAt4: m.coverageAt[3].toFixed(4),
          coverageAt5: record.entriesPerDay === 5 ? m.coverageAt[4].toFixed(4) : null,
        })
        .returning();

      const entryRows: (typeof backtestPlusEntries.$inferInsert)[] = [];
      for (const day of modelRun.days) {
        for (const entry of day.entries) {
          const candidate = candidateById.get(entry.candidateId);
          if (!candidate) throw new Error(`Candidato ${entry.candidateId} não encontrado no snapshot do pool.`);
          entryRows.push({
            modelId: modelRow.id,
            candidateId: candidate.id,
            targetDate: new Date(`${day.date}T00:00:00Z`),
            entryOrder: entry.entryOrder,
            result: entry.result,
            invalidReason: entry.invalidReason,
            candleOpenTime: entry.candle?.openTime ?? null,
            candleOpen: entry.candle?.open.toFixed(8) ?? null,
            candleHigh: entry.candle?.high.toFixed(8) ?? null,
            candleLow: entry.candle?.low.toFixed(8) ?? null,
            candleClose: entry.candle?.close.toFixed(8) ?? null,
            actualDirection: entry.actualDirection,
          });
        }
      }
      for (const batch of chunk(entryRows, INSERT_CHUNK_SIZE)) {
        await db.insert(backtestPlusEntries).values(batch);
      }
    }

    const bestModel = ranked[0].model;
    await db
      .update(backtestPlus)
      .set({
        status: "completed",
        progressPct: 100,
        effectiveStartDate: new Date(`${forwardDays[0]}T00:00:00Z`),
        effectiveEndDate: new Date(`${forwardDays[forwardDays.length - 1]}T00:00:00Z`),
        daysTested: forwardDays.length,
        bestModel,
        completedAt: new Date(),
      })
      .where(eq(backtestPlus.id, backtestId));

    return { backtestId, candlesLoaded: candles.length, daysTested: forwardDays.length, bestModel };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido ao processar o Backtest Plus.";
    await db
      .update(backtestPlus)
      .set({ status: "error", errorMessage: message, completedAt: new Date() })
      .where(eq(backtestPlus.id, backtestId));
    throw e;
  }
}

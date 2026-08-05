/**
 * Serviço de execução de um backtest já persistido — mesmo papel que
 * `analysis-service.ts` cumpre para a Analysis. Separado do Route Handler de
 * propósito: quando a Fase 4 (fila assíncrona) existir, o worker chama
 * exatamente `processBacktest(id)`, sem mudar a rota.
 */
import { Decimal } from "decimal.js";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { analysisConfigurations, backtestOperations, backtests, currencyPairs, patternResults } from "@/db/schema";
import { DojiPolicy } from "@/lib/core/candle-classifier";
import { parseTimeOfDay } from "@/lib/analysis/run-analysis";
import { DbCandleProvider } from "@/lib/db/candle-provider";
import { chunk } from "@/lib/api/http";
import { BacktestOperationResult, BacktestRunConfig, BacktestTarget, runBacktest } from "./run-backtest";

const INSERT_CHUNK_SIZE = 200;

export interface ProcessBacktestResult {
  backtestId: string;
  candlesLoaded: number;
  totalOperations: number;
  finalBankroll: string;
}

async function loadTargets(patternResultIds: string[]): Promise<BacktestTarget[]> {
  const rows = await db
    .select({
      currencyPairId: patternResults.currencyPairId,
      symbol: currencyPairs.symbol,
      timeframe: patternResults.timeframe,
      timeOfDay: patternResults.timeOfDay,
      timezone: patternResults.timezone,
      dojiTolerancePct: analysisConfigurations.dojiTolerancePct,
      minValidDays: analysisConfigurations.minValidDays,
    })
    .from(patternResults)
    .innerJoin(currencyPairs, eq(patternResults.currencyPairId, currencyPairs.id))
    .innerJoin(analysisConfigurations, eq(patternResults.analysisId, analysisConfigurations.analysisId))
    .where(inArray(patternResults.id, patternResultIds));

  return rows.map((r) => ({
    currencyPairId: r.currencyPairId,
    symbol: r.symbol,
    timeframe: r.timeframe,
    timeOfDay: parseTimeOfDay(r.timeOfDay),
    timezone: r.timezone,
    dojiTolerancePct: new Decimal(r.dojiTolerancePct),
    minValidDays: r.minValidDays,
  }));
}

function toOperationRow(
  backtestId: string,
  op: BacktestOperationResult
): typeof backtestOperations.$inferInsert {
  return {
    backtestId,
    operationDate: new Date(`${op.operationDate}T00:00:00Z`),
    currencyPairId: op.currencyPairId,
    timeOfDay: op.timeOfDay,
    entryDirection: op.entryDirection,
    actualDirection: op.actualDirection,
    martingaleLevelReached: op.martingaleLevelReached,
    entryValue: op.entryValue.toFixed(2),
    result: op.result,
    profitLoss: op.profitLoss.toFixed(2),
    bankrollAfter: op.bankrollAfter.toFixed(2),
  };
}

export async function processBacktest(backtestId: string): Promise<ProcessBacktestResult> {
  const [backtest] = await db.select().from(backtests).where(eq(backtests.id, backtestId)).limit(1);
  if (!backtest) {
    throw new Error(`Backtest ${backtestId} não encontrado.`);
  }

  await db
    .update(backtests)
    .set({ status: "processing", progressPct: 10, errorMessage: null })
    .where(eq(backtests.id, backtestId));

  try {
    const targets = await loadTargets(backtest.patternResultIds as string[]);
    if (targets.length === 0) {
      throw new Error("Nenhum dos patternResultIds selecionados foi encontrado.");
    }

    // agrupa por timeframe: DbCandleProvider carrega um timeframe por vez
    const targetsByTimeframe = new Map<string, BacktestTarget[]>();
    for (const t of targets) {
      const list = targetsByTimeframe.get(t.timeframe) ?? [];
      list.push(t);
      targetsByTimeframe.set(t.timeframe, list);
    }

    const candles = (
      await Promise.all(
        Array.from(targetsByTimeframe.entries()).map(([timeframe, group]) =>
          new DbCandleProvider({
            currencyPairIds: Array.from(new Set(group.map((t) => t.currencyPairId))),
            timeframe,
            to: backtest.periodEnd, // sem `from`: carrega todo o histórico disponível para a janela retroativa
          }).loadCandles()
        )
      )
    ).flat();

    await db.update(backtests).set({ progressPct: 40 }).where(eq(backtests.id, backtestId));

    const runConfig: BacktestRunConfig = {
      entryStrategy: backtest.entryStrategy,
      payoutPct: new Decimal(backtest.payoutPct),
      initialBankroll: new Decimal(backtest.initialBankroll),
      initialEntry: new Decimal(backtest.initialEntry),
      minProfit: new Decimal(backtest.minProfit),
      martingaleLevels: backtest.martingaleLevels,
      maxExposureLimit: backtest.maxExposureLimit ? new Decimal(backtest.maxExposureLimit) : undefined,
      dailyLossLimit: backtest.dailyLossLimit ? new Decimal(backtest.dailyLossLimit) : undefined,
      maxOperationsPerDay: backtest.maxOperationsPerDay ?? undefined,
      dojiPolicy: backtest.dojiPolicy as DojiPolicy,
      oneEntryPerTimeSlot: backtest.oneEntryPerTimeSlot,
      periodStart: backtest.periodStart,
      periodEnd: backtest.periodEnd,
    };

    const { operations, summary } = runBacktest(candles, targets, runConfig);

    await db.update(backtests).set({ progressPct: 80 }).where(eq(backtests.id, backtestId));

    // reprocessar um backtest substitui as operações anteriores
    await db.delete(backtestOperations).where(eq(backtestOperations.backtestId, backtestId));
    for (const batch of chunk(operations, INSERT_CHUNK_SIZE)) {
      await db.insert(backtestOperations).values(batch.map((op) => toOperationRow(backtestId, op)));
    }

    await db
      .update(backtests)
      .set({
        status: "completed",
        progressPct: 100,
        finalBankroll: summary.finalBankroll,
        totalOperations: summary.totalOperations,
        maxDrawdown: summary.maxDrawdown,
        profitFactor: summary.profitFactor,
        summary,
        completedAt: new Date(),
      })
      .where(eq(backtests.id, backtestId));

    return {
      backtestId,
      candlesLoaded: candles.length,
      totalOperations: summary.totalOperations,
      finalBankroll: summary.finalBankroll,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido ao processar o backtest.";
    await db
      .update(backtests)
      .set({ status: "error", errorMessage: message, completedAt: new Date() })
      .where(eq(backtests.id, backtestId));
    throw e;
  }
}

/**
 * Serviço de execução de um backtest já persistido — mesmo papel que
 * `analysis-service.ts` cumpre para a Analysis. Separado do Route Handler de
 * propósito: quando a Fase 4 (fila assíncrona) existir, o worker chama
 * exatamente `processBacktest(id)`, sem mudar a rota.
 *
 * O escopo de redescoberta diária (par(es), timeframe, janela, dias da
 * semana, limiares) vem inteiro da `AnalysisConfiguration` da análise de
 * origem dos horários selecionados — por isso `POST /api/backtests` exige
 * que todos os `patternResultIds` pertençam à mesma análise.
 */
import { Decimal } from "decimal.js";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  analysisConfigurations,
  backtestOperations,
  backtests,
  currencyPairs,
  patternResults,
} from "@/db/schema";
import { DojiPolicy } from "@/lib/core/candle-classifier";
import { DbCandleProvider } from "@/lib/db/candle-provider";
import { chunk } from "@/lib/api/http";
import { BacktestOperationResult, BacktestRunConfig, runBacktest } from "./run-backtest";

const INSERT_CHUNK_SIZE = 200;

export interface ProcessBacktestResult {
  backtestId: string;
  candlesLoaded: number;
  totalOperations: number;
  finalBankroll: string;
}

function toOperationRow(
  backtestId: string,
  op: BacktestOperationResult,
  symbolToId: Map<string, string>
): typeof backtestOperations.$inferInsert {
  const currencyPairId = symbolToId.get(op.symbol);
  if (!currencyPairId) {
    throw new Error(`Falha ao resolver o par de moedas "${op.symbol}" ao persistir a operação.`);
  }
  return {
    backtestId,
    operationDate: new Date(`${op.operationDate}T00:00:00Z`),
    currencyPairId,
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
    const patternResultIds = backtest.patternResultIds as string[];

    // todos os patternResultIds pertencem à mesma análise (garantido na criação) — pega o escopo de qualquer um
    const [scopeRow] = await db
      .select({ config: analysisConfigurations })
      .from(patternResults)
      .innerJoin(analysisConfigurations, eq(patternResults.analysisId, analysisConfigurations.analysisId))
      .where(inArray(patternResults.id, patternResultIds))
      .limit(1);

    if (!scopeRow) {
      throw new Error("Não foi possível carregar a configuração da análise de origem dos horários selecionados.");
    }
    const scope = scopeRow.config;
    const currencyPairIds = scope.currencyPairIds as string[];

    const pairs = await db
      .select({ id: currencyPairs.id, symbol: currencyPairs.symbol })
      .from(currencyPairs)
      .where(inArray(currencyPairs.id, currencyPairIds));
    const symbolToId = new Map(pairs.map((p) => [p.symbol, p.id]));

    const candles = await new DbCandleProvider({
      currencyPairIds,
      timeframe: scope.timeframe,
      to: backtest.periodEnd, // sem `from`: carrega todo o histórico disponível para a janela retroativa
    }).loadCandles();

    // Sem isso, um período pedido além do que foi importado silenciosamente
    // vira "0 operações" — sem pista nenhuma de que o problema é falta de
    // dado, não falta de padrão. Falha alto e explica exatamente o gap.
    const lastCandleTime = candles.reduce(
      (max, c) => (c.openTime > max ? c.openTime : max),
      new Date(0)
    );
    if (candles.length === 0 || lastCandleTime < backtest.periodStart) {
      const lastDate = candles.length === 0 ? null : lastCandleTime.toISOString().slice(0, 10);
      throw new Error(
        candles.length === 0
          ? `Nenhum candle importado para o escopo desta análise (timeframe ${scope.timeframe}). Importe dados antes de rodar o backtest.`
          : `Não há candles a partir de ${backtest.periodStart.toISOString().slice(0, 10)} — o último candle importado para esse escopo é de ${lastDate}. Importe dados mais recentes ou ajuste o período do backtest.`
      );
    }

    await db.update(backtests).set({ progressPct: 40 }).where(eq(backtests.id, backtestId));

    const runConfig: BacktestRunConfig = {
      timeframe: scope.timeframe,
      timezone: scope.timezone,
      startTime: scope.startTime,
      endTime: scope.endTime,
      weekdays: scope.weekdays as number[] | null,
      dojiTolerancePct: new Decimal(scope.dojiTolerancePct),
      minRepetitionPct: new Decimal(scope.minRepetitionPct),
      minValidDays: scope.minValidDays,
      slotCount: patternResultIds.length,
      entryStrategy: backtest.entryStrategy,
      payoutPct: new Decimal(backtest.payoutPct),
      initialBankroll: new Decimal(backtest.initialBankroll),
      initialEntry: new Decimal(backtest.initialEntry),
      minProfit: new Decimal(backtest.minProfit),
      maxExposureLimit: backtest.maxExposureLimit ? new Decimal(backtest.maxExposureLimit) : undefined,
      dojiPolicy: backtest.dojiPolicy as DojiPolicy,
      periodStart: backtest.periodStart,
      periodEnd: backtest.periodEnd,
    };

    const { operations, summary } = runBacktest(candles, runConfig);

    await db.update(backtests).set({ progressPct: 80 }).where(eq(backtests.id, backtestId));

    // reprocessar um backtest substitui as operações anteriores
    await db.delete(backtestOperations).where(eq(backtestOperations.backtestId, backtestId));
    for (const batch of chunk(operations, INSERT_CHUNK_SIZE)) {
      await db.insert(backtestOperations).values(batch.map((op) => toOperationRow(backtestId, op, symbolToId)));
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

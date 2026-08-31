/**
 * Serviço de execução de uma Análise Plus já persistida — mesmo formato de
 * `src/lib/analysis/analysis-service.ts` (rota chama dentro do próprio
 * request hoje; pronto pra virar processamento assíncrono depois sem mudar
 * a assinatura).
 *
 * Busca os candles do período máximo UMA ÚNICA VEZ (seção 17 do briefing) e
 * delega todo o cálculo multi-período pro motor puro
 * (`src/lib/analysis/multi-period-analysis.ts`).
 */
import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  multiPeriodAnalyses,
  multiPeriodAnalysisConfigurations,
  multiPeriodPatternResults,
  multiPeriodWindows,
} from "@/db/schema";
import { DojiPolicy } from "@/lib/core/candle-classifier";
import { DbCandleProvider } from "@/lib/db/candle-provider";
import { loadSymbolsByIds } from "@/lib/db/currency-pairs";
import { chunk } from "@/lib/api/http";
import { formatTimeOfDay } from "@/lib/analysis/run-analysis";
import { MultiPeriodPatternResult, analyzeMultiPeriod } from "@/lib/analysis/multi-period-analysis";

const INSERT_CHUNK_SIZE = 200;

export interface ProcessMultiPeriodAnalysisResult {
  analysisId: string;
  candlesLoaded: number;
  patternsFound: number;
  referenceDate: Date;
  periodStart: Date;
}

export async function processMultiPeriodAnalysis(analysisId: string): Promise<ProcessMultiPeriodAnalysisResult> {
  const [config] = await db
    .select()
    .from(multiPeriodAnalysisConfigurations)
    .where(eq(multiPeriodAnalysisConfigurations.analysisId, analysisId))
    .limit(1);

  if (!config) {
    throw new Error(`Análise Plus ${analysisId} não possui configuração associada.`);
  }

  // Todas as janelas (estruturais e a de momentum) terminam na mesma
  // `referenceDate` — nunca usam candles posteriores a ela. No modo "período
  // específico" (`config.endDate` presente) ela é FIXA — reprocessar não faz
  // a janela rolar com o tempo. No modo "últimos N dias" ela é "agora",
  // capturada uma única vez neste processamento.
  const referenceDate = config.endDate ?? new Date();
  const periodStart = new Date(referenceDate.getTime() - config.maxDays * 24 * 60 * 60 * 1000);

  await db
    .update(multiPeriodAnalyses)
    .set({ status: "processing", progressPct: 10, errorMessage: null, referenceDate })
    .where(eq(multiPeriodAnalyses.id, analysisId));

  try {
    const currencyPairIds = config.currencyPairIds as string[];

    const provider = new DbCandleProvider({
      currencyPairIds,
      timeframe: config.timeframe,
      from: periodStart,
      to: referenceDate,
    });
    const candles = await provider.loadCandles();

    await db.update(multiPeriodAnalyses).set({ progressPct: 40 }).where(eq(multiPeriodAnalyses.id, analysisId));

    const results = analyzeMultiPeriod(
      candles,
      {
        timeframe: config.timeframe,
        timezone: config.timezone,
        startTime: config.startTime,
        endTime: config.endTime,
        weekdays: (config.weekdays as number[] | null) ?? null,
        dojiTolerancePct: new Decimal(config.dojiTolerancePct),
        dojiPolicy: config.dojiPolicy as DojiPolicy,
        maxDays: config.maxDays,
        persistenceThresholdPct: new Decimal(config.persistenceThresholdPct),
      },
      referenceDate
    );

    await db.update(multiPeriodAnalyses).set({ progressPct: 70 }).where(eq(multiPeriodAnalyses.id, analysisId));

    // símbolo -> currency_pair_id, pra gravar com a FK correta
    const symbolsById = await loadSymbolsByIds(currencyPairIds);
    const idsBySymbol = new Map(Array.from(symbolsById, ([id, symbol]) => [symbol, id]));

    // reprocessar substitui os resultados anteriores (cascade apaga as janelas)
    await db.delete(multiPeriodPatternResults).where(eq(multiPeriodPatternResults.analysisId, analysisId));

    // Uma análise em timeframes curtos pode descobrir centenas de slots
    // (par+horário) — gravar um resultado por vez (insert+returning
    // individual) significaria centenas de idas-e-voltas sequenciais ao
    // Neon, extremamente lento. Em vez disso: insere os resultados em lotes
    // e correlaciona os ids retornados de volta aos resultados pela chave
    // natural (currencyPairId+timeOfDay+direction, única dentro da análise),
    // sem depender da ordem de retorno do banco. Só então monta e insere
    // TODAS as janelas de TODOS os padrões, também em lotes.
    const resultsWithPairId = results
      .map((result) => ({ result, currencyPairId: idsBySymbol.get(result.symbol) }))
      .filter((r): r is { result: MultiPeriodPatternResult; currencyPairId: string } => !!r.currencyPairId);

    function correlationKey(currencyPairId: string, timeOfDay: string, direction: string): string {
      return `${currencyPairId}|${timeOfDay}|${direction}`;
    }

    const idByCorrelationKey = new Map<string, string>();
    for (const batch of chunk(resultsWithPairId, INSERT_CHUNK_SIZE)) {
      const inserted = await db
        .insert(multiPeriodPatternResults)
        .values(batch.map(({ result, currencyPairId }) => toPatternResultRow(analysisId, currencyPairId, result)))
        .returning({
          id: multiPeriodPatternResults.id,
          currencyPairId: multiPeriodPatternResults.currencyPairId,
          timeOfDay: multiPeriodPatternResults.timeOfDay,
          direction: multiPeriodPatternResults.direction,
        });
      for (const row of inserted) {
        idByCorrelationKey.set(correlationKey(row.currencyPairId, row.timeOfDay, row.direction), row.id);
      }
    }

    const windowRows = resultsWithPairId.flatMap(({ result, currencyPairId }) => {
      const timeOfDay = formatTimeOfDay(result.timeOfDay);
      const patternResultId = idByCorrelationKey.get(correlationKey(currencyPairId, timeOfDay, result.direction));
      if (!patternResultId) return [];
      return [...result.windows, result.momentumWindow].map((w) => ({
        patternResultId,
        days: w.days,
        isMomentum: w.isMomentum,
        frequency: w.frequency.toFixed(2),
        validSamples: w.validSamples,
        callCount: w.callCount,
        putCount: w.putCount,
        dojiCount: w.dojiCount,
        occurrences: w.occurrences,
      }));
    });
    for (const batch of chunk(windowRows, INSERT_CHUNK_SIZE)) {
      await db.insert(multiPeriodWindows).values(batch);
    }

    await db
      .update(multiPeriodAnalyses)
      .set({ status: "completed", progressPct: 100, completedAt: new Date() })
      .where(eq(multiPeriodAnalyses.id, analysisId));

    return {
      analysisId,
      candlesLoaded: candles.length,
      patternsFound: resultsWithPairId.length,
      referenceDate,
      periodStart,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido ao processar a Análise Plus.";
    await db
      .update(multiPeriodAnalyses)
      .set({ status: "error", errorMessage: message, completedAt: new Date() })
      .where(eq(multiPeriodAnalyses.id, analysisId));
    throw e;
  }
}

function toPatternResultRow(
  analysisId: string,
  currencyPairId: string,
  result: MultiPeriodPatternResult
): typeof multiPeriodPatternResults.$inferInsert {
  const momentum = result.momentumWindow;
  return {
    analysisId,
    currencyPairId,
    timeframe: result.timeframe,
    timeOfDay: formatTimeOfDay(result.timeOfDay),
    timezone: result.timezone,
    direction: result.direction,
    structuralAverage: result.structuralAverage.toFixed(2),
    confidenceScore: result.confidenceScore,
    classification: result.classification,
    recommendation: result.recommendation,
    momentumTrend: result.momentumTrend,
    inversionState: result.inversion,
    persistenceConfirmed: result.persistence.confirmed,
    persistenceTotal: result.persistence.total,
    persistencePercentage: result.persistence.percentage.toFixed(2),
    stabilityRange: result.stability.range.toFixed(2),
    stabilityStdDev: result.stability.standardDeviation.toFixed(2),
    totalValid: result.totalValid,
    sampleMin: result.sampleMin,
    scorePersistence: result.scores.persistence.toFixed(2),
    scoreFrequency: result.scores.frequency.toFixed(2),
    scoreStability: result.scores.stability.toFixed(2),
    scoreSample: result.scores.sample.toFixed(2),
    scoreMomentum: result.scores.momentum.toFixed(2),
    recentMomentumFrequency: momentum.frequency.toFixed(2),
    recentMomentumOppositeFrequency: result.momentumOppositeFrequency.toFixed(2),
    recentMomentumValidSamples: momentum.validSamples,
  };
}

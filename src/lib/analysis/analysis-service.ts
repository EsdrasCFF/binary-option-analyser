/**
 * Serviço de execução de uma análise já persistida.
 *
 * Separado do Route Handler de propósito: na Fase 4 (processamento
 * assíncrono) o worker/queue vai chamar exatamente `processAnalysis(id)`,
 * sem que a rota precise mudar. Hoje a rota chama esta função dentro do
 * próprio request.
 */
import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { analyses, analysisConfigurations, patternResults } from "@/db/schema";
import { DojiPolicy } from "@/lib/core/candle-classifier";
import { PatternResult } from "@/lib/core/pattern-analyzer";
import { DbCandleProvider } from "@/lib/db/candle-provider";
import { loadSymbolsByIds } from "@/lib/db/currency-pairs";
import { chunk } from "@/lib/api/http";
import { AnalysisRunConfig, formatTimeOfDay, runAnalysis } from "./run-analysis";

const INSERT_CHUNK_SIZE = 200;

export interface ProcessAnalysisResult {
  analysisId: string;
  candlesLoaded: number;
  patternsFound: number;
  periodStart: Date | null;
  periodEnd: Date | null;
}

/** Resolve o período efetivo da análise (datas explícitas ou N dias para trás). */
export function resolvePeriod(
  config: { startDate: Date | null; endDate: Date | null; historicalDays: number | null },
  now: Date
): { from: Date | null; to: Date | null } {
  if (config.startDate || config.endDate) {
    return { from: config.startDate, to: config.endDate };
  }
  if (config.historicalDays && config.historicalDays > 0) {
    const from = new Date(now.getTime() - config.historicalDays * 24 * 60 * 60 * 1000);
    return { from, to: now };
  }
  return { from: null, to: null };
}

function toRow(
  analysisId: string,
  result: PatternResult,
  currencyPairId: string
): typeof patternResults.$inferInsert {
  return {
    analysisId,
    currencyPairId,
    timeframe: result.timeframe,
    timeOfDay: formatTimeOfDay(result.timeOfDay),
    timezone: result.timezone,
    totalDaysAnalyzed: result.totalDaysAnalyzed,
    totalValid: result.totalValid,
    callCount: result.callCount,
    putCount: result.putCount,
    dojiCount: result.dojiCount,
    predominantDirection: result.predominantDirection ?? null,
    repetitionPct: result.repetitionPct.toFixed(2),
    recent5Pct: result.recent5Pct?.toFixed(2) ?? null,
    recent10Pct: result.recent10Pct?.toFixed(2) ?? null,
    recent20PctPeriodPct: result.recent20PctPeriodPct?.toFixed(2) ?? null,
    currentStreak: result.currentStreak,
    lastOccurrenceDate: result.lastOccurrenceDate
      ? new Date(`${result.lastOccurrenceDate}T00:00:00Z`)
      : null,
    daysSinceLastOccurrence: result.daysSinceLastOccurrence,
    status: result.status,
    confidenceNote: result.confidenceNote,
    occurrences: result.occurrences,
  };
}

/**
 * Executa a análise: carrega candles, roda o motor estatístico e grava os
 * PatternResult. Atualiza `analyses.status` em todas as saídas (inclusive erro),
 * para que o frontend possa acompanhar por polling.
 */
export async function processAnalysis(analysisId: string): Promise<ProcessAnalysisResult> {
  const [config] = await db
    .select()
    .from(analysisConfigurations)
    .where(eq(analysisConfigurations.analysisId, analysisId))
    .limit(1);

  if (!config) {
    throw new Error(`Análise ${analysisId} não possui configuração associada.`);
  }

  await db
    .update(analyses)
    .set({ status: "processing", progressPct: 10, errorMessage: null })
    .where(eq(analyses.id, analysisId));

  try {
    const currencyPairIds = config.currencyPairIds as string[];
    const { from, to } = resolvePeriod(
      {
        startDate: config.startDate,
        endDate: config.endDate,
        historicalDays: config.historicalDays,
      },
      new Date()
    );

    const provider = new DbCandleProvider({
      currencyPairIds,
      timeframe: config.timeframe,
      from: from ?? undefined,
      to: to ?? undefined,
    });
    const candles = await provider.loadCandles();

    await db.update(analyses).set({ progressPct: 40 }).where(eq(analyses.id, analysisId));

    const runConfig: AnalysisRunConfig = {
      timeframe: config.timeframe,
      timezone: config.timezone,
      startTime: config.startTime,
      endTime: config.endTime,
      weekdays: (config.weekdays as number[] | null) ?? null,
      dojiTolerancePct: new Decimal(config.dojiTolerancePct),
      dojiPolicy: config.dojiPolicy as DojiPolicy,
      minRepetitionPct: new Decimal(config.minRepetitionPct),
      minValidDays: config.minValidDays,
      topN: config.topN,
    };

    const results = runAnalysis(candles, runConfig);

    // símbolo -> currency_pair_id, para gravar o resultado com a FK correta
    const symbolsById = await loadSymbolsByIds(currencyPairIds);
    const idsBySymbol = new Map(Array.from(symbolsById, ([id, symbol]) => [symbol, id]));

    // reprocessar uma análise substitui os resultados anteriores
    await db.delete(patternResults).where(eq(patternResults.analysisId, analysisId));

    const rows = results
      .map((r) => {
        const currencyPairId = idsBySymbol.get(r.symbol);
        return currencyPairId ? toRow(analysisId, r, currencyPairId) : null;
      })
      .filter((row): row is typeof patternResults.$inferInsert => row !== null);

    for (const batch of chunk(rows, INSERT_CHUNK_SIZE)) {
      await db.insert(patternResults).values(batch);
    }

    await db
      .update(analyses)
      .set({ status: "completed", progressPct: 100, completedAt: new Date() })
      .where(eq(analyses.id, analysisId));

    return {
      analysisId,
      candlesLoaded: candles.length,
      patternsFound: rows.length,
      periodStart: from,
      periodEnd: to,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido ao processar a análise.";
    await db
      .update(analyses)
      .set({ status: "error", errorMessage: message, completedAt: new Date() })
      .where(eq(analyses.id, analysisId));
    throw e;
  }
}

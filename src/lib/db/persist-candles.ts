/**
 * Persistência de candles já carregados (de qualquer `CandleDataProvider`)
 * em `candles`, com o bookkeeping de `import_jobs`. Compartilhado pelas
 * rotas de importação (CSV, Yahoo Finance, e futuras fontes).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { candles as candlesTable, dataProviders, importJobs } from "@/db/schema";
import { Candle } from "@/lib/core/candle-classifier";
import { ApiError, chunk, isUuid } from "@/lib/api/http";
import { ensureCurrencyPairs } from "./currency-pairs";

const INSERT_CHUNK_SIZE = 500;

/** Reutiliza (ou cria) um data_provider do usuário quando nenhum é informado. */
export async function resolveDataProviderId(
  userId: string,
  requested: unknown,
  type: "csv" | "api",
  defaultName: string
): Promise<string> {
  if (typeof requested === "string" && requested.length > 0) {
    if (!isUuid(requested)) {
      throw new ApiError("dataProviderId inválido (esperado UUID).", 400);
    }
    const [found] = await db
      .select({ id: dataProviders.id })
      .from(dataProviders)
      .where(and(eq(dataProviders.id, requested), eq(dataProviders.userId, userId)))
      .limit(1);
    if (!found) {
      throw new ApiError("dataProviderId não encontrado para este usuário.", 404);
    }
    return found.id;
  }

  const [existing] = await db
    .select({ id: dataProviders.id })
    .from(dataProviders)
    .where(and(eq(dataProviders.userId, userId), eq(dataProviders.type, type)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(dataProviders)
    .values({ userId, name: defaultName, type })
    .returning({ id: dataProviders.id });
  return created.id;
}

export interface PersistCandlesResult {
  importJobId: string;
  dataProviderId: string;
  status: "completed";
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  symbols: string[];
  timeframes: string[];
}

/**
 * Grava candles em lotes com `ON CONFLICT DO NOTHING` (índice único de
 * par+timeframe+open_time+source garante que reimportar não duplica).
 * Cria o `import_job`, atualiza status em toda saída (inclusive erro).
 */
export async function persistImportedCandles(params: {
  userId: string;
  dataProviderId: string;
  fileName?: string | null;
  candles: Candle[];
}): Promise<PersistCandlesResult> {
  const { userId, dataProviderId, fileName, candles } = params;
  if (candles.length === 0) {
    throw new ApiError("Nenhum candle para importar.", 422);
  }

  const [job] = await db
    .insert(importJobs)
    .values({ userId, dataProviderId, fileName: fileName ?? null, status: "processing" })
    .returning({ id: importJobs.id });

  try {
    const pairIds = await ensureCurrencyPairs(candles.map((c) => c.symbol));

    const rows = candles.map((c) => {
      const currencyPairId = pairIds.get(c.symbol);
      if (!currencyPairId) {
        throw new ApiError(`Falha ao resolver o par de moedas "${c.symbol}".`, 500);
      }
      return {
        currencyPairId,
        timeframe: c.timeframe,
        openTime: c.openTime,
        closeTime: c.closeTime,
        open: c.open.toString(),
        high: c.high.toString(),
        low: c.low.toString(),
        close: c.close.toString(),
        volume: c.volume === null ? null : c.volume.toString(),
        source: c.source,
      };
    });

    let importedRows = 0;
    for (const batch of chunk(rows, INSERT_CHUNK_SIZE)) {
      const inserted = await db
        .insert(candlesTable)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: candlesTable.id });
      importedRows += inserted.length;
    }
    const duplicateRows = rows.length - importedRows;

    await db
      .update(importJobs)
      .set({
        status: "completed",
        progressPct: 100,
        totalRows: rows.length,
        importedRows,
        duplicateRows,
        errorRows: 0,
        completedAt: new Date(),
      })
      .where(eq(importJobs.id, job.id));

    return {
      importJobId: job.id,
      dataProviderId,
      status: "completed",
      totalRows: rows.length,
      importedRows,
      duplicateRows,
      symbols: Array.from(pairIds.keys()).sort(),
      timeframes: Array.from(new Set(candles.map((c) => c.timeframe))).sort(),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido na importação.";
    await db
      .update(importJobs)
      .set({ status: "error", errorMessage: message, completedAt: new Date() })
      .where(eq(importJobs.id, job.id));

    if (e instanceof ApiError) throw e;
    throw new ApiError(message, 422, { importJobId: job.id });
  }
}

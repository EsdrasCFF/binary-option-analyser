/**
 * GET /api/multi-period-pattern-results — lista, filtra e ordena os padrões
 * multi-período encontrados (visão "tabela" — campos achatados, sem as
 * janelas). Pra ver a análise por janela de um padrão específico, use
 * GET /api/multi-period-pattern-results/:id.
 *
 * Query params (todos opcionais):
 *   analysisId, currencyPairId, direction=CALL|PUT,
 *   classification=excelente|forte|bom|observar|descartar,
 *   recommendation=a_favor|contra|observar|descartar,
 *   sortBy=confidenceScore|structuralAverage|timeOfDay|persistencePercentage (default confidenceScore),
 *   order=asc|desc (default desc), limit (1..500, default 100), offset
 *
 * O escopo é sempre restrito às análises do usuário autenticado.
 */
import { NextRequest, NextResponse } from "next/server";
import { SQL, and, asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { currencyPairs, multiPeriodAnalyses, multiPeriodPatternResults } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { handleErrors, parseSearchParams, uuidString } from "@/lib/api/http";

const querySchema = z.object({
  analysisId: uuidString.optional(),
  currencyPairId: uuidString.optional(),
  direction: z.enum(["CALL", "PUT"]).optional(),
  classification: z.enum(["excelente", "forte", "bom", "observar", "descartar"]).optional(),
  recommendation: z.enum(["a_favor", "contra", "observar", "descartar"]).optional(),
  sortBy: z.enum(["confidenceScore", "structuralAverage", "timeOfDay", "persistencePercentage"]).default("confidenceScore"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const SORT_COLUMNS = {
  confidenceScore: multiPeriodPatternResults.confidenceScore,
  structuralAverage: multiPeriodPatternResults.structuralAverage,
  timeOfDay: multiPeriodPatternResults.timeOfDay,
  persistencePercentage: multiPeriodPatternResults.persistencePercentage,
} as const;

export async function GET(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const q = parseSearchParams(new URL(req.url), querySchema);

    const conditions: SQL[] = [eq(multiPeriodAnalyses.userId, userId)];
    if (q.analysisId) conditions.push(eq(multiPeriodPatternResults.analysisId, q.analysisId));
    if (q.currencyPairId) conditions.push(eq(multiPeriodPatternResults.currencyPairId, q.currencyPairId));
    if (q.direction) conditions.push(eq(multiPeriodPatternResults.direction, q.direction));
    if (q.classification) conditions.push(eq(multiPeriodPatternResults.classification, q.classification));
    if (q.recommendation) conditions.push(eq(multiPeriodPatternResults.recommendation, q.recommendation));
    const where = and(...conditions);

    const sortColumn = SORT_COLUMNS[q.sortBy];
    const orderBy = q.order === "asc" ? asc(sortColumn) : desc(sortColumn);

    const items = await db
      .select({
        patternResult: multiPeriodPatternResults,
        symbol: currencyPairs.symbol,
        analysisName: multiPeriodAnalyses.name,
      })
      .from(multiPeriodPatternResults)
      .innerJoin(multiPeriodAnalyses, eq(multiPeriodPatternResults.analysisId, multiPeriodAnalyses.id))
      .innerJoin(currencyPairs, eq(multiPeriodPatternResults.currencyPairId, currencyPairs.id))
      .where(where)
      .orderBy(orderBy)
      .limit(q.limit)
      .offset(q.offset);

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(multiPeriodPatternResults)
      .innerJoin(multiPeriodAnalyses, eq(multiPeriodPatternResults.analysisId, multiPeriodAnalyses.id))
      .where(where);

    return NextResponse.json({
      items: items.map((row) => ({
        ...row.patternResult,
        symbol: row.symbol,
        analysisName: row.analysisName,
      })),
      total,
      limit: q.limit,
      offset: q.offset,
    });
  });
}

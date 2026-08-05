/**
 * GET /api/pattern-results — lista, filtra e ordena os padrões encontrados.
 *
 * Query params (todos opcionais):
 *   analysisId, currencyPairId, timeframe, timeOfDay ("HH:mm"), status,
 *   minPct, onlyActive=true, direction=CALL|PUT,
 *   sortBy=repetitionPct|totalValid|recent10Pct|timeOfDay (default repetitionPct),
 *   order=asc|desc (default desc), limit (1..500, default 100), offset
 *
 * Os filtros/ordenação reproduzem a semântica de `rankPatterns` do motor
 * (`minPct`, `onlyActive`, `sortBy`), mas executados em SQL: a lista é
 * paginada e pode ter muitos milhares de linhas, então não faz sentido
 * carregar tudo em memória para ordenar. O ranking em memória continua
 * disponível em `src/lib/core/pattern-analyzer.ts` para uso dentro do motor.
 *
 * O escopo é sempre restrito às análises do usuário autenticado (INNER JOIN
 * em `analyses`), então não é possível ler resultados de outro usuário nem
 * informando o analysisId dele.
 */
import { NextRequest, NextResponse } from "next/server";
import { SQL, and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { analyses, currencyPairs, patternResults } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { decimalString, handleErrors, parseSearchParams, uuidString } from "@/lib/api/http";

const ACTIVE_STATUSES = ["forte_e_ativo", "ativo"] as const;

const querySchema = z.object({
  analysisId: uuidString.optional(),
  currencyPairId: uuidString.optional(),
  timeframe: z.string().min(1).max(10).optional(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  status: z
    .enum(["forte_e_ativo", "ativo", "perdendo_forca", "inativo", "amostra_insuficiente"])
    .optional(),
  direction: z.enum(["CALL", "PUT"]).optional(),
  minPct: decimalString.optional(),
  onlyActive: z.enum(["true", "false"]).optional(),
  sortBy: z.enum(["repetitionPct", "totalValid", "recent10Pct", "timeOfDay"]).default("repetitionPct"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const SORT_COLUMNS = {
  repetitionPct: patternResults.repetitionPct,
  totalValid: patternResults.totalValid,
  recent10Pct: patternResults.recent10Pct,
  timeOfDay: patternResults.timeOfDay,
} as const;

export async function GET(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const q = parseSearchParams(new URL(req.url), querySchema);

    const conditions: SQL[] = [eq(analyses.userId, userId)];
    if (q.analysisId) conditions.push(eq(patternResults.analysisId, q.analysisId));
    if (q.currencyPairId) conditions.push(eq(patternResults.currencyPairId, q.currencyPairId));
    if (q.timeframe) conditions.push(eq(patternResults.timeframe, q.timeframe));
    if (q.timeOfDay) conditions.push(eq(patternResults.timeOfDay, q.timeOfDay));
    if (q.status) conditions.push(eq(patternResults.status, q.status));
    if (q.direction) conditions.push(eq(patternResults.predominantDirection, q.direction));
    if (q.minPct) conditions.push(gte(patternResults.repetitionPct, q.minPct));
    if (q.onlyActive === "true") {
      conditions.push(inArray(patternResults.status, [...ACTIVE_STATUSES]));
    }
    const where = and(...conditions);

    // NULLS LAST em ambas as direções: padrões sem histórico recente suficiente
    // (recent10Pct nulo) nunca devem aparecer no topo do ranking.
    const sortColumn = SORT_COLUMNS[q.sortBy];
    const orderBy =
      q.sortBy === "recent10Pct"
        ? sql`${sortColumn} ${sql.raw(q.order)} NULLS LAST`
        : q.order === "asc"
          ? asc(sortColumn)
          : desc(sortColumn);

    const items = await db
      .select({
        patternResult: patternResults,
        symbol: currencyPairs.symbol,
        analysisName: analyses.name,
      })
      .from(patternResults)
      .innerJoin(analyses, eq(patternResults.analysisId, analyses.id))
      .innerJoin(currencyPairs, eq(patternResults.currencyPairId, currencyPairs.id))
      .where(where)
      .orderBy(orderBy)
      .limit(q.limit)
      .offset(q.offset);

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(patternResults)
      .innerJoin(analyses, eq(patternResults.analysisId, analyses.id))
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

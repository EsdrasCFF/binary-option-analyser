/**
 * GET /api/pattern-results — lista, filtra e ordena os padrões encontrados.
 *
 * Query params (todos opcionais):
 *   analysisId, currencyPairId, timeframe, timeOfDay ("HH:mm"),
 *   period=madrugada|manha|tarde|noite, status,
 *   minPct, onlyActive=true, direction=CALL|PUT,
 *   sortBy=repetitionPct|totalValid|recent10Pct|timeOfDay|direction (default repetitionPct),
 *   order=asc|desc (default desc), limit (1..500, default 100), offset
 *
 * `period` divide o dia em 4 turnos fixos (madrugada 00:00–05:59, manhã
 * 06:00–11:59, tarde 12:00–17:59, noite 18:00–23:59) e filtra pelo `timeOfDay`
 * do padrão — comparação lexicográfica direto na string "HH:mm" (funciona
 * porque todo valor é zero-padded de 5 caracteres, sem precisar de cast).
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
import { SQL, and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { analyses, currencyPairs, patternResults } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { decimalString, handleErrors, parseSearchParams, uuidString } from "@/lib/api/http";

const ACTIVE_STATUSES = ["forte_e_ativo", "ativo"] as const;

const DAY_PERIODS = {
  madrugada: { start: "00:00", end: "05:59" },
  manha: { start: "06:00", end: "11:59" },
  tarde: { start: "12:00", end: "17:59" },
  noite: { start: "18:00", end: "23:59" },
} as const;

const querySchema = z.object({
  analysisId: uuidString.optional(),
  currencyPairId: uuidString.optional(),
  timeframe: z.string().min(1).max(10).optional(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  period: z.enum(["madrugada", "manha", "tarde", "noite"]).optional(),
  status: z
    .enum(["forte_e_ativo", "ativo", "perdendo_forca", "inativo", "amostra_insuficiente"])
    .optional(),
  direction: z.enum(["CALL", "PUT"]).optional(),
  minPct: decimalString.optional(),
  onlyActive: z.enum(["true", "false"]).optional(),
  sortBy: z
    .enum(["repetitionPct", "totalValid", "recent10Pct", "timeOfDay", "direction"])
    .default("repetitionPct"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const SORT_COLUMNS = {
  repetitionPct: patternResults.repetitionPct,
  totalValid: patternResults.totalValid,
  recent10Pct: patternResults.recent10Pct,
  timeOfDay: patternResults.timeOfDay,
  direction: patternResults.predominantDirection,
} as const;

/** Colunas que podem ser nulas (amostra insuficiente/doji) — sempre por último, nunca no topo do ranking. */
const NULLS_LAST_COLUMNS = new Set<keyof typeof SORT_COLUMNS>(["recent10Pct", "direction"]);

export async function GET(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const q = parseSearchParams(new URL(req.url), querySchema);

    const conditions: SQL[] = [eq(analyses.userId, userId)];
    if (q.analysisId) conditions.push(eq(patternResults.analysisId, q.analysisId));
    if (q.currencyPairId) conditions.push(eq(patternResults.currencyPairId, q.currencyPairId));
    if (q.timeframe) conditions.push(eq(patternResults.timeframe, q.timeframe));
    if (q.timeOfDay) conditions.push(eq(patternResults.timeOfDay, q.timeOfDay));
    if (q.period) {
      const { start, end } = DAY_PERIODS[q.period];
      conditions.push(gte(patternResults.timeOfDay, start), lte(patternResults.timeOfDay, end));
    }
    if (q.status) conditions.push(eq(patternResults.status, q.status));
    if (q.direction) conditions.push(eq(patternResults.predominantDirection, q.direction));
    if (q.minPct) conditions.push(gte(patternResults.repetitionPct, q.minPct));
    if (q.onlyActive === "true") {
      conditions.push(inArray(patternResults.status, [...ACTIVE_STATUSES]));
    }
    const where = and(...conditions);

    // NULLS LAST em ambas as direções: padrões sem histórico recente suficiente
    // (recent10Pct nulo) ou sem direção predominante (amostra insuficiente/doji)
    // nunca devem aparecer no topo do ranking.
    const sortColumn = SORT_COLUMNS[q.sortBy];
    const orderBy = NULLS_LAST_COLUMNS.has(q.sortBy)
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

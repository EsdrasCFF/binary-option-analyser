/**
 * GET /api/backtests/:id/operations — lista paginada das operações simuladas
 * (uma linha por operação, podendo cobrir vários candles do Martingale).
 *
 * Query params: currencyPairId, timeOfDay, result (win|loss|tie),
 * limit (1..500, default 100), offset.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { backtestOperations, backtests, currencyPairs } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, isUuid, parseSearchParams, uuidString } from "@/lib/api/http";

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z.object({
  currencyPairId: uuidString.optional(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  result: z.enum(["win", "loss", "tie"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new ApiError("Identificador inválido (esperado UUID).", 400);

    const [backtest] = await db
      .select({ id: backtests.id })
      .from(backtests)
      .where(and(eq(backtests.id, id), eq(backtests.userId, userId)))
      .limit(1);
    if (!backtest) throw new ApiError("Backtest não encontrado.", 404);

    const q = parseSearchParams(new URL(req.url), querySchema);
    const conditions = [eq(backtestOperations.backtestId, id)];
    if (q.currencyPairId) conditions.push(eq(backtestOperations.currencyPairId, q.currencyPairId));
    if (q.timeOfDay) conditions.push(eq(backtestOperations.timeOfDay, q.timeOfDay));
    if (q.result) conditions.push(eq(backtestOperations.result, q.result));
    const where = and(...conditions);

    const items = await db
      .select({ operation: backtestOperations, symbol: currencyPairs.symbol })
      .from(backtestOperations)
      .innerJoin(currencyPairs, eq(backtestOperations.currencyPairId, currencyPairs.id))
      .where(where)
      .orderBy(asc(backtestOperations.operationDate))
      .limit(q.limit)
      .offset(q.offset);

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(backtestOperations)
      .where(where);

    return NextResponse.json({
      items: items.map((row) => ({ ...row.operation, symbol: row.symbol })),
      total,
      limit: q.limit,
      offset: q.offset,
    });
  });
}

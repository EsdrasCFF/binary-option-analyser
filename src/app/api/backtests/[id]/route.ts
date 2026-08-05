/**
 * GET /api/backtests/:id — detalhe + status/progresso + resumo agregado
 * (usado no polling do frontend enquanto o backtest processa).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { backtests } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, isUuid } from "@/lib/api/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new ApiError("Identificador inválido (esperado UUID).", 400);

    const [backtest] = await db
      .select()
      .from(backtests)
      .where(and(eq(backtests.id, id), eq(backtests.userId, userId)))
      .limit(1);

    if (!backtest) throw new ApiError("Backtest não encontrado.", 404);
    return NextResponse.json(backtest);
  });
}

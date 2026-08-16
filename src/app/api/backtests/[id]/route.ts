/**
 * GET    /api/backtests/:id — detalhe + status/progresso + resumo agregado
 *                             (usado no polling do frontend enquanto o backtest processa).
 * PATCH  /api/backtests/:id — renomeia o backtest (único campo editável depois de criado).
 * DELETE /api/backtests/:id — remove o backtest (cascade apaga as operações).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { backtests } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, isUuid, parseJsonBody } from "@/lib/api/http";

type RouteContext = { params: Promise<{ id: string }> };

const patchBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
});

async function loadOwnedBacktest(id: string) {
  const userId = await requireUserId();
  if (!isUuid(id)) throw new ApiError("Identificador inválido (esperado UUID).", 400);

  const [backtest] = await db
    .select()
    .from(backtests)
    .where(and(eq(backtests.id, id), eq(backtests.userId, userId)))
    .limit(1);

  if (!backtest) throw new ApiError("Backtest não encontrado.", 404);
  return backtest;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    const backtest = await loadOwnedBacktest(id);
    return NextResponse.json(backtest);
  });
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    await loadOwnedBacktest(id);
    const body = await parseJsonBody(req, patchBodySchema);

    const [updated] = await db
      .update(backtests)
      .set({ name: body.name })
      .where(eq(backtests.id, id))
      .returning();

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    await loadOwnedBacktest(id);
    await db.delete(backtests).where(eq(backtests.id, id));
    return new NextResponse(null, { status: 204 });
  });
}

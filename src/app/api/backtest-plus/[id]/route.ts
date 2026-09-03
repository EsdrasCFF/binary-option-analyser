/**
 * GET    /api/backtest-plus/:id — detalhe completo: backtest + pool de 10
 *                                 candidatos (auditoria) + os 5 modelos (já
 *                                 ordenados pelo placar comparativo) + o
 *                                 dia-a-dia de entradas de cada modelo.
 * PATCH  /api/backtest-plus/:id — renomeia (único campo editável depois de criado).
 * DELETE /api/backtest-plus/:id — remove (cascade apaga candidatos/modelos/entradas).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { backtestPlus, backtestPlusCandidates, backtestPlusEntries, backtestPlusModels } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, isUuid, parseJsonBody } from "@/lib/api/http";

type RouteContext = { params: Promise<{ id: string }> };

const patchBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
});

async function loadOwnedBacktestPlus(id: string) {
  const userId = await requireUserId();
  if (!isUuid(id)) throw new ApiError("Identificador inválido (esperado UUID).", 400);

  const [record] = await db
    .select()
    .from(backtestPlus)
    .where(and(eq(backtestPlus.id, id), eq(backtestPlus.userId, userId)))
    .limit(1);

  if (!record) throw new ApiError("Backtest Plus não encontrado.", 404);
  return record;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    const record = await loadOwnedBacktestPlus(id);

    const candidates = await db
      .select()
      .from(backtestPlusCandidates)
      .where(eq(backtestPlusCandidates.backtestId, id))
      .orderBy(asc(backtestPlusCandidates.poolRank));

    const models = await db
      .select()
      .from(backtestPlusModels)
      .where(eq(backtestPlusModels.backtestId, id))
      .orderBy(asc(backtestPlusModels.rankPosition));

    const modelIds = models.map((m) => m.id);
    const entries =
      modelIds.length > 0
        ? await db
            .select()
            .from(backtestPlusEntries)
            .where(inArray(backtestPlusEntries.modelId, modelIds))
            .orderBy(asc(backtestPlusEntries.targetDate), asc(backtestPlusEntries.entryOrder))
        : [];

    const entriesByModel = new Map<string, typeof entries>();
    for (const entry of entries) {
      const list = entriesByModel.get(entry.modelId) ?? [];
      list.push(entry);
      entriesByModel.set(entry.modelId, list);
    }

    const candidateById = new Map(candidates.map((c) => [c.id, c]));

    return NextResponse.json({
      backtestPlus: record,
      candidates,
      models: models.map((model) => ({
        ...model,
        entries: (entriesByModel.get(model.id) ?? []).map((entry) => ({
          ...entry,
          candidate: candidateById.get(entry.candidateId) ?? null,
        })),
      })),
    });
  });
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    await loadOwnedBacktestPlus(id);
    const body = await parseJsonBody(req, patchBodySchema);

    const [updated] = await db
      .update(backtestPlus)
      .set({ name: body.name })
      .where(eq(backtestPlus.id, id))
      .returning();

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    await loadOwnedBacktestPlus(id);
    await db.delete(backtestPlus).where(eq(backtestPlus.id, id));
    return new NextResponse(null, { status: 204 });
  });
}

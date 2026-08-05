/**
 * GET    /api/analyses/:id — detalhe + configuração + status (usado no polling
 *                            do frontend enquanto a análise processa).
 * DELETE /api/analyses/:id — remove a análise (cascade apaga configuração e
 *                            pattern_results).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { analyses, analysisConfigurations, patternResults } from "@/db/schema";
import { count } from "drizzle-orm";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, isUuid } from "@/lib/api/http";

type RouteContext = { params: Promise<{ id: string }> };

async function loadOwnedAnalysis(id: string) {
  const userId = await requireUserId();
  if (!isUuid(id)) throw new ApiError("Identificador inválido (esperado UUID).", 400);

  const [analysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.id, id), eq(analyses.userId, userId)))
    .limit(1);

  if (!analysis) throw new ApiError("Análise não encontrada.", 404);
  return analysis;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    const analysis = await loadOwnedAnalysis(id);

    const [configuration] = await db
      .select()
      .from(analysisConfigurations)
      .where(eq(analysisConfigurations.analysisId, id))
      .limit(1);

    const [{ value: patternResultCount }] = await db
      .select({ value: count() })
      .from(patternResults)
      .where(eq(patternResults.analysisId, id));

    return NextResponse.json({
      analysis,
      configuration: configuration ?? null,
      patternResultCount,
    });
  });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    await loadOwnedAnalysis(id);
    await db.delete(analyses).where(eq(analyses.id, id));
    return new NextResponse(null, { status: 204 });
  });
}

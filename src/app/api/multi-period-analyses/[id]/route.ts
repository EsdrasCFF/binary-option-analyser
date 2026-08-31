/**
 * GET    /api/multi-period-analyses/:id — detalhe + configuração + status
 *                                         (polling enquanto processa).
 * DELETE /api/multi-period-analyses/:id — remove (cascade apaga configuração,
 *                                         pattern_results e windows).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { multiPeriodAnalyses, multiPeriodAnalysisConfigurations, multiPeriodPatternResults } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, isUuid } from "@/lib/api/http";

type RouteContext = { params: Promise<{ id: string }> };

async function loadOwnedAnalysis(id: string) {
  const userId = await requireUserId();
  if (!isUuid(id)) throw new ApiError("Identificador inválido (esperado UUID).", 400);

  const [analysis] = await db
    .select()
    .from(multiPeriodAnalyses)
    .where(and(eq(multiPeriodAnalyses.id, id), eq(multiPeriodAnalyses.userId, userId)))
    .limit(1);

  if (!analysis) throw new ApiError("Análise Plus não encontrada.", 404);
  return analysis;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    const analysis = await loadOwnedAnalysis(id);

    const [configuration] = await db
      .select()
      .from(multiPeriodAnalysisConfigurations)
      .where(eq(multiPeriodAnalysisConfigurations.analysisId, id))
      .limit(1);

    const [{ value: patternResultCount }] = await db
      .select({ value: count() })
      .from(multiPeriodPatternResults)
      .where(eq(multiPeriodPatternResults.analysisId, id));

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
    await db.delete(multiPeriodAnalyses).where(eq(multiPeriodAnalyses.id, id));
    return new NextResponse(null, { status: 204 });
  });
}

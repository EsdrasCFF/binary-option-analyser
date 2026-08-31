/**
 * GET /api/multi-period-pattern-results/:id — detalhe de UM padrão
 * multi-período: os campos consolidados + todas as janelas (estruturais +
 * momentum), usado pra popular a linha expandida na tabela ("Análise
 * Multiperíodo").
 */
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { currencyPairs, multiPeriodAnalyses, multiPeriodPatternResults, multiPeriodWindows } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, isUuid } from "@/lib/api/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new ApiError("Identificador inválido (esperado UUID).", 400);

    const [row] = await db
      .select({
        patternResult: multiPeriodPatternResults,
        symbol: currencyPairs.symbol,
        analysisName: multiPeriodAnalyses.name,
      })
      .from(multiPeriodPatternResults)
      .innerJoin(multiPeriodAnalyses, eq(multiPeriodPatternResults.analysisId, multiPeriodAnalyses.id))
      .innerJoin(currencyPairs, eq(multiPeriodPatternResults.currencyPairId, currencyPairs.id))
      .where(and(eq(multiPeriodPatternResults.id, id), eq(multiPeriodAnalyses.userId, userId)))
      .limit(1);

    if (!row) throw new ApiError("Padrão não encontrado.", 404);

    const windows = await db
      .select()
      .from(multiPeriodWindows)
      .where(eq(multiPeriodWindows.patternResultId, id))
      .orderBy(asc(multiPeriodWindows.days));

    return NextResponse.json({
      ...row.patternResult,
      symbol: row.symbol,
      analysisName: row.analysisName,
      // janelas estruturais da maior pra menor + a de momentum separada, pro frontend não ter que filtrar
      windows: windows.filter((w) => !w.isMomentum).sort((a, b) => b.days - a.days),
      momentumWindow: windows.find((w) => w.isMomentum) ?? null,
    });
  });
}

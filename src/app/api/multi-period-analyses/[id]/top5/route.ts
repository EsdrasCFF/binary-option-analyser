/**
 * GET /api/multi-period-analyses/:id/top5 — seção 13 do briefing: os 5
 * melhores padrões por Confidence Score (não simplesmente os 5 maiores
 * percentuais), com desempate por persistência > estabilidade > amostra >
 * frequência média (`selectTopPatterns`). Cada item já vem com as janelas,
 * pra tela não precisar de round-trips extras.
 */
import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { currencyPairs, multiPeriodAnalyses, multiPeriodPatternResults, multiPeriodWindows } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, isUuid, parseSearchParams } from "@/lib/api/http";
import { MultiPeriodPatternResult, selectTopPatterns } from "@/lib/analysis/multi-period-analysis";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

/** `selectTopPatterns` só lê estes campos pra ordenar/desempatar — não precisamos reconstruir o objeto inteiro do motor a partir das linhas do banco. */
type RankableRow = Pick<
  MultiPeriodPatternResult,
  "confidenceScore" | "persistence" | "stability" | "sampleMin" | "structuralAverage"
> & {
  patternResult: typeof multiPeriodPatternResults.$inferSelect;
  symbol: string;
};

const querySchema = z.object({ count: z.coerce.number().int().min(1).max(20).default(5) });

export async function GET(req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new ApiError("Identificador inválido (esperado UUID).", 400);
    const { count } = parseSearchParams(new URL(req.url), querySchema);

    const [analysis] = await db
      .select({ id: multiPeriodAnalyses.id })
      .from(multiPeriodAnalyses)
      .where(and(eq(multiPeriodAnalyses.id, id), eq(multiPeriodAnalyses.userId, userId)))
      .limit(1);
    if (!analysis) throw new ApiError("Análise Plus não encontrada.", 404);

    const rows = await db
      .select({
        patternResult: multiPeriodPatternResults,
        symbol: currencyPairs.symbol,
      })
      .from(multiPeriodPatternResults)
      .innerJoin(currencyPairs, eq(multiPeriodPatternResults.currencyPairId, currencyPairs.id))
      .where(eq(multiPeriodPatternResults.analysisId, id));

    // `selectTopPatterns` só usa esses campos pra ordenar/desempatar — mapeamos
    // as strings numéricas do banco pra Decimal antes de reaproveitar a mesma
    // lógica de desempate do motor (persistência > estabilidade > amostra > frequência média).
    const candidates: RankableRow[] = rows.map((r) => ({
      ...r,
      confidenceScore: r.patternResult.confidenceScore,
      persistence: { confirmed: r.patternResult.persistenceConfirmed, total: r.patternResult.persistenceTotal, percentage: new Decimal(r.patternResult.persistencePercentage) },
      stability: { range: new Decimal(r.patternResult.stabilityRange), standardDeviation: new Decimal(r.patternResult.stabilityStdDev) },
      sampleMin: r.patternResult.sampleMin,
      structuralAverage: new Decimal(r.patternResult.structuralAverage),
    }));

    const top = selectTopPatterns(candidates as unknown as MultiPeriodPatternResult[], count) as unknown as RankableRow[];
    const topIds = top.map((t) => t.patternResult.id);

    const windowRows = topIds.length
      ? await db
          .select()
          .from(multiPeriodWindows)
          .where(inArray(multiPeriodWindows.patternResultId, topIds))
          .orderBy(asc(multiPeriodWindows.days))
      : [];
    const windowsByPattern = new Map<string, typeof windowRows>();
    for (const w of windowRows) {
      const list = windowsByPattern.get(w.patternResultId) ?? [];
      list.push(w);
      windowsByPattern.set(w.patternResultId, list);
    }

    return NextResponse.json({
      items: top.map((t) => {
        const windows = windowsByPattern.get(t.patternResult.id) ?? [];
        return {
          ...t.patternResult,
          symbol: t.symbol,
          windows: windows.filter((w) => !w.isMomentum).sort((a, b) => b.days - a.days),
          momentumWindow: windows.find((w) => w.isMomentum) ?? null,
        };
      }),
    });
  });
}

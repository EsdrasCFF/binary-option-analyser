/**
 * POST /api/backtest-plus — cria um Backtest Plus a partir de uma Análise
 * Plus JÁ CONCLUÍDA e executa os 5 modelos (motor de `src/lib/backtest-plus`).
 * GET  /api/backtest-plus — lista os Backtest Plus do usuário.
 *
 * Exemplo de body:
 * {
 *   "sourceAnalysisId": "<uuid>",
 *   "candidateIds": ["<uuid>", ... exatamente 10],
 *   "entriesPerDay": 5,
 *   "forwardDaysRequested": 3,
 *   "name": "Pool EUR/USD + GBP/USD"
 * }
 *
 * `candidateIds` precisam ser 10 `multiPeriodPatternResults` distintos,
 * TODOS pertencentes a `sourceAnalysisId` — a ordem do array vira
 * `poolRank` (0-9), usado como desempate determinístico pelos modelos.
 *
 * `?process=false` cria o registro sem executar (mesmo escape hatch de
 * `POST /api/backtests`, útil para a futura fila assíncrona).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { backtestPlus, backtestPlusCandidates, currencyPairs, multiPeriodAnalyses, multiPeriodPatternResults } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, parseJsonBody, uuidString } from "@/lib/api/http";
import { generateRandomSeed, processBacktestPlus, toCandidateSnapshotRow } from "@/lib/backtest-plus/backtest-plus-service";

const POOL_SIZE = 10;

const bodySchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  sourceAnalysisId: uuidString,
  candidateIds: z.array(uuidString).length(POOL_SIZE, `Selecione exatamente ${POOL_SIZE} candidatos.`),
  entriesPerDay: z.union([z.literal(4), z.literal(5)]),
  forwardDaysRequested: z.number().int().min(1).max(5),
});

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const body = await parseJsonBody(req, bodySchema);

    if (new Set(body.candidateIds).size !== POOL_SIZE) {
      throw new ApiError(`Os ${POOL_SIZE} candidatos precisam ser distintos.`, 422);
    }

    const [analysis] = await db
      .select()
      .from(multiPeriodAnalyses)
      .where(and(eq(multiPeriodAnalyses.id, body.sourceAnalysisId), eq(multiPeriodAnalyses.userId, userId)))
      .limit(1);
    if (!analysis) throw new ApiError("Análise Plus de origem não encontrada.", 404);
    if (analysis.status !== "completed" || !analysis.referenceDate) {
      throw new ApiError("A Análise Plus de origem precisa estar concluída antes de criar um Backtest Plus.", 422);
    }

    // os candidatos precisam existir e pertencer TODOS a esta análise — resolve symbol junto (join com currencyPairs)
    const candidateRows = await db
      .select({ result: multiPeriodPatternResults, symbol: currencyPairs.symbol })
      .from(multiPeriodPatternResults)
      .innerJoin(currencyPairs, eq(multiPeriodPatternResults.currencyPairId, currencyPairs.id))
      .where(
        and(
          inArray(multiPeriodPatternResults.id, body.candidateIds),
          eq(multiPeriodPatternResults.analysisId, body.sourceAnalysisId)
        )
      );
    if (candidateRows.length !== POOL_SIZE) {
      throw new ApiError(
        `Um ou mais candidatos não existem ou não pertencem à Análise Plus informada.`,
        404
      );
    }
    const byId = new Map(candidateRows.map((r) => [r.result.id, r]));

    const [record] = await db
      .insert(backtestPlus)
      .values({
        userId,
        sourceAnalysisId: body.sourceAnalysisId,
        name: body.name ?? null,
        referenceDate: analysis.referenceDate,
        entriesPerDay: body.entriesPerDay,
        forwardDaysRequested: body.forwardDaysRequested,
        randomSeed: generateRandomSeed(),
        status: "pending",
      })
      .returning();

    // poolRank preserva a ordem em que o usuário selecionou os candidatos
    await db.insert(backtestPlusCandidates).values(
      body.candidateIds.map((id, poolRank) => {
        const row = byId.get(id)!;
        return toCandidateSnapshotRow(record.id, poolRank, row.symbol, row.result);
      })
    );

    const shouldProcess = new URL(req.url).searchParams.get("process") !== "false";
    if (!shouldProcess) {
      return NextResponse.json({ backtestPlus: record, processed: false }, { status: 201 });
    }

    try {
      const result = await processBacktestPlus(record.id);
      const [updated] = await db.select().from(backtestPlus).where(eq(backtestPlus.id, record.id)).limit(1);
      return NextResponse.json({ backtestPlus: updated, processed: true, ...result }, { status: 201 });
    } catch (e) {
      const [failed] = await db.select().from(backtestPlus).where(eq(backtestPlus.id, record.id)).limit(1);
      return NextResponse.json(
        { backtestPlus: failed, processed: true, error: failed?.errorMessage ?? (e as Error).message },
        { status: 201 }
      );
    }
  });
}

export async function GET(_req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const items = await db
      .select({
        backtestPlus,
        sourceAnalysisName: multiPeriodAnalyses.name,
      })
      .from(backtestPlus)
      .innerJoin(multiPeriodAnalyses, eq(backtestPlus.sourceAnalysisId, multiPeriodAnalyses.id))
      .where(eq(backtestPlus.userId, userId))
      .orderBy(desc(backtestPlus.createdAt));

    return NextResponse.json({
      items: items.map((row) => ({ ...row.backtestPlus, sourceAnalysisName: row.sourceAnalysisName })),
    });
  });
}

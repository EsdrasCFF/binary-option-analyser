/**
 * GET    /api/bankroll-ledgers/:id — detalhe: dados do ledger, os horários
 *                                    disponíveis pra escolher em cada linha
 *                                    (`availableSlots`) — TODOS os da
 *                                    análise vinculada quando é de período
 *                                    único, ou só o TOP 20 por Confidence
 *                                    Score quando é uma Análise Plus — as
 *                                    linhas já lançadas (com saldo acumulado
 *                                    calculado em ordem) e os totais.
 * PATCH  /api/bankroll-ledgers/:id — renomeia, ajusta a banca inicial e/ou
 *                                    troca a análise vinculada (inclusive de
 *                                    um tipo pro outro — período único <->
 *                                    Plus). Trocar a análise não apaga nem
 *                                    afeta as linhas já lançadas: cada uma
 *                                    guarda seu próprio
 *                                    patternResultId/multiPeriodPatternResultId,
 *                                    resolvido direto na consulta.
 * DELETE /api/bankroll-ledgers/:id — remove (cascade apaga as linhas).
 */
import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { and, asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/db/client";
import {
  analyses,
  bankrollLedgerEntries,
  bankrollLedgers,
  currencyPairs,
  multiPeriodAnalyses,
  multiPeriodPatternResults,
  patternResults,
} from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, decimalString, handleErrors, isUuid, parseJsonBody, uuidString } from "@/lib/api/http";

type RouteContext = { params: Promise<{ id: string }> };

const TOP_PLUS_SLOTS = 20;

const patchBodySchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    initialBankroll: decimalString.optional(),
    analysisId: uuidString.optional(),
    multiPeriodAnalysisId: uuidString.optional(),
  })
  .refine((v) => !(v.analysisId !== undefined && v.multiPeriodAnalysisId !== undefined), {
    message: "Informe no máximo um entre analysisId e multiPeriodAnalysisId.",
  });

async function loadOwnedLedger(id: string) {
  const userId = await requireUserId();
  if (!isUuid(id)) throw new ApiError("Identificador inválido (esperado UUID).", 400);

  const [ledger] = await db
    .select()
    .from(bankrollLedgers)
    .where(and(eq(bankrollLedgers.id, id), eq(bankrollLedgers.userId, userId)))
    .limit(1);

  if (!ledger) throw new ApiError("Gerenciamento não encontrado.", 404);
  return ledger;
}

const currencyPairsSingle = alias(currencyPairs, "currency_pairs_single");
const currencyPairsPlus = alias(currencyPairs, "currency_pairs_plus");

export async function GET(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    const ledger = await loadOwnedLedger(id);
    const isPlus = ledger.multiPeriodAnalysisId !== null;

    const analysisName = isPlus
      ? (await db.select({ name: multiPeriodAnalyses.name }).from(multiPeriodAnalyses).where(eq(multiPeriodAnalyses.id, ledger.multiPeriodAnalysisId!)))[0]?.name
      : (await db.select({ name: analyses.name }).from(analyses).where(eq(analyses.id, ledger.analysisId!)))[0]?.name;

    const availableSlots = isPlus
      ? (
          await db
            .select({
              id: multiPeriodPatternResults.id,
              symbol: currencyPairsPlus.symbol,
              timeOfDay: multiPeriodPatternResults.timeOfDay,
              predominantDirection: multiPeriodPatternResults.direction,
              confidenceScore: multiPeriodPatternResults.confidenceScore,
            })
            .from(multiPeriodPatternResults)
            .innerJoin(currencyPairsPlus, eq(multiPeriodPatternResults.currencyPairId, currencyPairsPlus.id))
            .where(eq(multiPeriodPatternResults.analysisId, ledger.multiPeriodAnalysisId!))
            .orderBy(desc(multiPeriodPatternResults.confidenceScore))
            .limit(TOP_PLUS_SLOTS)
        ).map((s) => ({ ...s, type: "plus" as const }))
      : (
          await db
            .select({
              id: patternResults.id,
              symbol: currencyPairsSingle.symbol,
              timeOfDay: patternResults.timeOfDay,
              predominantDirection: patternResults.predominantDirection,
            })
            .from(patternResults)
            .innerJoin(currencyPairsSingle, eq(patternResults.currencyPairId, currencyPairsSingle.id))
            .where(eq(patternResults.analysisId, ledger.analysisId!))
            .orderBy(asc(currencyPairsSingle.symbol), asc(patternResults.timeOfDay))
        ).map((s) => ({ ...s, type: "single" as const, confidenceScore: null }));

    // cada linha resolve seu próprio horário direto pela FK que tiver
    // preenchida (patternResultId OU multiPeriodPatternResultId) — o tipo do
    // ledger AGORA não precisa bater com o tipo de cada linha: trocar a
    // análise vinculada não afeta o que já foi lançado antes da troca.
    const entryRows = await db
      .select({
        entry: bankrollLedgerEntries,
        singleSymbol: currencyPairsSingle.symbol,
        singleTimeOfDay: patternResults.timeOfDay,
        singleDirection: patternResults.predominantDirection,
        plusSymbol: currencyPairsPlus.symbol,
        plusTimeOfDay: multiPeriodPatternResults.timeOfDay,
        plusDirection: multiPeriodPatternResults.direction,
      })
      .from(bankrollLedgerEntries)
      .leftJoin(patternResults, eq(bankrollLedgerEntries.patternResultId, patternResults.id))
      .leftJoin(currencyPairsSingle, eq(patternResults.currencyPairId, currencyPairsSingle.id))
      .leftJoin(multiPeriodPatternResults, eq(bankrollLedgerEntries.multiPeriodPatternResultId, multiPeriodPatternResults.id))
      .leftJoin(currencyPairsPlus, eq(multiPeriodPatternResults.currencyPairId, currencyPairsPlus.id))
      .where(eq(bankrollLedgerEntries.ledgerId, id))
      .orderBy(asc(bankrollLedgerEntries.date), asc(bankrollLedgerEntries.createdAt));

    let running = new Decimal(ledger.initialBankroll);
    let wins = 0;
    let losses = 0;
    let ties = 0;
    const entries = entryRows.map((r) => {
      running = running.plus(r.entry.profitLoss).toDecimalPlaces(2);
      if (r.entry.result === "win") wins++;
      else if (r.entry.result === "loss") losses++;
      else ties++;
      return {
        ...r.entry,
        symbol: r.singleSymbol ?? r.plusSymbol ?? "—",
        timeOfDay: r.singleTimeOfDay ?? r.plusTimeOfDay ?? "—",
        predominantDirection: r.singleDirection ?? r.plusDirection ?? null,
        bankrollAfter: running.toFixed(2),
      };
    });

    return NextResponse.json({
      ledger: { ...ledger, analysisType: isPlus ? "plus" : "single" },
      analysisName: analysisName ?? null,
      availableSlots,
      entries,
      totals: {
        totalOperations: entries.length,
        wins,
        losses,
        ties,
        currentBalance: running.toFixed(2),
      },
    });
  });
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    const ledger = await loadOwnedLedger(id);
    const body = await parseJsonBody(req, patchBodySchema);

    if (body.initialBankroll !== undefined && Number(body.initialBankroll) <= 0) {
      throw new ApiError("initialBankroll deve ser maior que zero.", 422);
    }

    if (body.analysisId !== undefined) {
      const [analysis] = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(and(eq(analyses.id, body.analysisId), eq(analyses.userId, ledger.userId)))
        .limit(1);
      if (!analysis) throw new ApiError("Análise não encontrada.", 404);
    }
    if (body.multiPeriodAnalysisId !== undefined) {
      const [analysis] = await db
        .select({ id: multiPeriodAnalyses.id })
        .from(multiPeriodAnalyses)
        .where(and(eq(multiPeriodAnalyses.id, body.multiPeriodAnalysisId), eq(multiPeriodAnalyses.userId, ledger.userId)))
        .limit(1);
      if (!analysis) throw new ApiError("Análise Plus não encontrada.", 404);
    }

    const [updated] = await db
      .update(bankrollLedgers)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.initialBankroll !== undefined ? { initialBankroll: body.initialBankroll } : {}),
        // trocar pra um tipo sempre limpa o outro — nunca os dois preenchidos ao mesmo tempo.
        ...(body.analysisId !== undefined ? { analysisId: body.analysisId, multiPeriodAnalysisId: null } : {}),
        ...(body.multiPeriodAnalysisId !== undefined
          ? { multiPeriodAnalysisId: body.multiPeriodAnalysisId, analysisId: null }
          : {}),
      })
      .where(eq(bankrollLedgers.id, id))
      .returning();

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    await loadOwnedLedger(id);
    await db.delete(bankrollLedgers).where(eq(bankrollLedgers.id, id));
    return new NextResponse(null, { status: 204 });
  });
}

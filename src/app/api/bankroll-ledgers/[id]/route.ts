/**
 * GET    /api/bankroll-ledgers/:id — detalhe: dados do ledger, os horários
 *                                    disponíveis pra escolher em cada linha
 *                                    (`availableSlots`, TODOS os da análise
 *                                    vinculada no momento — não só os
 *                                    selecionados na criação), as linhas já
 *                                    lançadas (com saldo acumulado calculado
 *                                    em ordem) e os totais.
 * PATCH  /api/bankroll-ledgers/:id — renomeia, ajusta a banca inicial e/ou
 *                                    troca a análise vinculada. Trocar a
 *                                    análise não apaga nem afeta as linhas já
 *                                    lançadas: cada uma guarda seu próprio
 *                                    patternResultId, resolvido direto na
 *                                    consulta.
 * DELETE /api/bankroll-ledgers/:id — remove (cascade apaga as linhas).
 */
import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { analyses, bankrollLedgerEntries, bankrollLedgers, currencyPairs, patternResults } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, decimalString, handleErrors, isUuid, parseJsonBody, uuidString } from "@/lib/api/http";

type RouteContext = { params: Promise<{ id: string }> };

const patchBodySchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  initialBankroll: decimalString.optional(),
  analysisId: uuidString.optional(),
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

export async function GET(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id } = await ctx.params;
    const ledger = await loadOwnedLedger(id);

    const [analysis] = await db.select({ name: analyses.name }).from(analyses).where(eq(analyses.id, ledger.analysisId));

    const availableSlots = await db
      .select({
        id: patternResults.id,
        symbol: currencyPairs.symbol,
        timeOfDay: patternResults.timeOfDay,
        predominantDirection: patternResults.predominantDirection,
      })
      .from(patternResults)
      .innerJoin(currencyPairs, eq(patternResults.currencyPairId, currencyPairs.id))
      .where(eq(patternResults.analysisId, ledger.analysisId))
      .orderBy(asc(currencyPairs.symbol), asc(patternResults.timeOfDay));

    const entryRows = await db
      .select({
        entry: bankrollLedgerEntries,
        symbol: currencyPairs.symbol,
        timeOfDay: patternResults.timeOfDay,
        predominantDirection: patternResults.predominantDirection,
      })
      .from(bankrollLedgerEntries)
      .innerJoin(patternResults, eq(bankrollLedgerEntries.patternResultId, patternResults.id))
      .innerJoin(currencyPairs, eq(patternResults.currencyPairId, currencyPairs.id))
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
        symbol: r.symbol,
        timeOfDay: r.timeOfDay,
        predominantDirection: r.predominantDirection,
        bankrollAfter: running.toFixed(2),
      };
    });

    return NextResponse.json({
      ledger,
      analysisName: analysis?.name ?? null,
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

    const [updated] = await db
      .update(bankrollLedgers)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.initialBankroll !== undefined ? { initialBankroll: body.initialBankroll } : {}),
        ...(body.analysisId !== undefined ? { analysisId: body.analysisId } : {}),
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

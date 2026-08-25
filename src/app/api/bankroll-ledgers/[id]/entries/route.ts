/**
 * POST /api/bankroll-ledgers/:id/entries — adiciona uma linha à planilha.
 * `patternResultId` precisa ser um horário da análise vinculada NO MOMENTO
 * (`ledger.analysisId`) — não fica restrito ao que foi selecionado quando o
 * ledger foi criado. O resultado (vitória/derrota/empate) é informado pelo
 * chamador — não é buscado no histórico de candles — o servidor só calcula o
 * R$ da linha via `computeEntryProfitLoss`.
 */
import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { bankrollLedgerEntries, bankrollLedgers, patternResults } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, decimalString, handleErrors, isUuid, isoDateTimeString, parseJsonBody, uuidString } from "@/lib/api/http";
import { computeEntryProfitLoss } from "@/lib/core/bankroll-ledger";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  patternResultId: uuidString,
  date: isoDateTimeString,
  payoutPct: decimalString,
  entryValue: decimalString,
  result: z.enum(["win", "loss", "tie"]),
});

export async function POST(req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new ApiError("Identificador inválido (esperado UUID).", 400);

    const [ledger] = await db
      .select()
      .from(bankrollLedgers)
      .where(and(eq(bankrollLedgers.id, id), eq(bankrollLedgers.userId, userId)))
      .limit(1);
    if (!ledger) throw new ApiError("Gerenciamento não encontrado.", 404);

    const body = await parseJsonBody(req, bodySchema);

    if (Number(body.entryValue) <= 0) throw new ApiError("entryValue deve ser maior que zero.", 422);
    const payout = new Decimal(body.payoutPct);
    if (payout.lte(0) || payout.gt(100)) throw new ApiError("payoutPct deve estar entre 0 (exclusivo) e 100.", 422);

    const [pattern] = await db
      .select({ id: patternResults.id })
      .from(patternResults)
      .where(and(eq(patternResults.id, body.patternResultId), eq(patternResults.analysisId, ledger.analysisId)))
      .limit(1);
    if (!pattern) {
      throw new ApiError("Esse horário não pertence à análise vinculada a este gerenciamento.", 422);
    }

    const profitLoss = computeEntryProfitLoss(new Decimal(body.entryValue), payout, body.result);

    const [entry] = await db
      .insert(bankrollLedgerEntries)
      .values({
        ledgerId: id,
        patternResultId: body.patternResultId,
        date: new Date(body.date),
        payoutPct: body.payoutPct,
        entryValue: body.entryValue,
        result: body.result,
        profitLoss: profitLoss.toFixed(2),
      })
      .returning();

    return NextResponse.json(entry, { status: 201 });
  });
}

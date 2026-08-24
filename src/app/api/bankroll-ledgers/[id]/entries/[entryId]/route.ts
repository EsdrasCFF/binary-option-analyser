/**
 * PATCH  /api/bankroll-ledgers/:id/entries/:entryId — edita uma linha
 *        (campos parciais); recalcula `profitLoss` com os valores finais.
 * DELETE /api/bankroll-ledgers/:id/entries/:entryId — remove uma linha.
 */
import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { bankrollLedgerEntries, bankrollLedgers } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, decimalString, handleErrors, isUuid, isoDateTimeString, parseJsonBody, uuidString } from "@/lib/api/http";
import { computeEntryProfitLoss } from "@/lib/core/bankroll-ledger";

type RouteContext = { params: Promise<{ id: string; entryId: string }> };

const patchBodySchema = z.object({
  patternResultId: uuidString.optional(),
  date: isoDateTimeString.optional(),
  payoutPct: decimalString.optional(),
  entryValue: decimalString.optional(),
  result: z.enum(["win", "loss", "tie"]).optional(),
});

async function loadOwnedLedgerAndEntry(ledgerId: string, entryId: string) {
  const userId = await requireUserId();
  if (!isUuid(ledgerId) || !isUuid(entryId)) throw new ApiError("Identificador inválido (esperado UUID).", 400);

  const [ledger] = await db
    .select()
    .from(bankrollLedgers)
    .where(and(eq(bankrollLedgers.id, ledgerId), eq(bankrollLedgers.userId, userId)))
    .limit(1);
  if (!ledger) throw new ApiError("Gerenciamento não encontrado.", 404);

  const [entry] = await db
    .select()
    .from(bankrollLedgerEntries)
    .where(and(eq(bankrollLedgerEntries.id, entryId), eq(bankrollLedgerEntries.ledgerId, ledgerId)))
    .limit(1);
  if (!entry) throw new ApiError("Operação não encontrada.", 404);

  return { ledger, entry };
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id, entryId } = await ctx.params;
    const { ledger, entry } = await loadOwnedLedgerAndEntry(id, entryId);
    const body = await parseJsonBody(req, patchBodySchema);

    if (body.patternResultId !== undefined) {
      const allowedIds = ledger.patternResultIds as string[];
      if (!allowedIds.includes(body.patternResultId)) {
        throw new ApiError("Esse horário não está entre os selecionados neste gerenciamento.", 422);
      }
    }
    if (body.entryValue !== undefined && Number(body.entryValue) <= 0) {
      throw new ApiError("entryValue deve ser maior que zero.", 422);
    }
    if (body.payoutPct !== undefined) {
      const payout = new Decimal(body.payoutPct);
      if (payout.lte(0) || payout.gt(100)) throw new ApiError("payoutPct deve estar entre 0 (exclusivo) e 100.", 422);
    }

    const finalPayoutPct = body.payoutPct ?? entry.payoutPct;
    const finalEntryValue = body.entryValue ?? entry.entryValue;
    const finalResult = body.result ?? (entry.result as "win" | "loss" | "tie");
    const profitLoss = computeEntryProfitLoss(new Decimal(finalEntryValue), new Decimal(finalPayoutPct), finalResult);

    const [updated] = await db
      .update(bankrollLedgerEntries)
      .set({
        ...(body.patternResultId !== undefined ? { patternResultId: body.patternResultId } : {}),
        ...(body.date !== undefined ? { date: new Date(body.date) } : {}),
        payoutPct: finalPayoutPct,
        entryValue: finalEntryValue,
        result: finalResult,
        profitLoss: profitLoss.toFixed(2),
      })
      .where(eq(bankrollLedgerEntries.id, entryId))
      .returning();

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const { id, entryId } = await ctx.params;
    await loadOwnedLedgerAndEntry(id, entryId);
    await db.delete(bankrollLedgerEntries).where(eq(bankrollLedgerEntries.id, entryId));
    return new NextResponse(null, { status: 204 });
  });
}

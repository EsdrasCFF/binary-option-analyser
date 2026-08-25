/**
 * POST /api/bankroll-ledgers — cria um gerenciamento de banca MANUAL (a
 * "planilha") vinculado a UMA análise. GET /api/bankroll-ledgers — lista os
 * gerenciamentos do usuário, com saldo atual e total de operações já
 * agregados.
 *
 * Diferente do Backtest, aqui não roda simulação nenhuma: o usuário escolhe
 * o horário (entre TODOS os da análise vinculada), o %, a entrada, e MARCA
 * manualmente o resultado — o sistema só calcula o R$ de cada linha
 * (`computeEntryProfitLoss`) e o saldo acumulado. Ver
 * `src/lib/core/bankroll-ledger.ts`.
 *
 * Exemplo de body:
 * {
 *   "analysisId": "<uuid>",
 *   "name": "Gerenciamento manhã",
 *   "initialBankroll": "1000"
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { and, count, desc, eq, sum } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { analyses, bankrollLedgerEntries, bankrollLedgers } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, decimalString, handleErrors, parseJsonBody, uuidString } from "@/lib/api/http";

const bodySchema = z.object({
  analysisId: uuidString,
  name: z.string().trim().min(1).max(60).optional(),
  initialBankroll: decimalString,
});

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const body = await parseJsonBody(req, bodySchema);

    if (Number(body.initialBankroll) <= 0) {
      throw new ApiError("initialBankroll deve ser maior que zero.", 422);
    }

    const [analysis] = await db
      .select({ id: analyses.id })
      .from(analyses)
      .where(and(eq(analyses.id, body.analysisId), eq(analyses.userId, userId)))
      .limit(1);
    if (!analysis) throw new ApiError("Análise não encontrada.", 404);

    const [ledger] = await db
      .insert(bankrollLedgers)
      .values({
        userId,
        analysisId: body.analysisId,
        name: body.name ?? null,
        initialBankroll: body.initialBankroll,
      })
      .returning();

    return NextResponse.json(ledger, { status: 201 });
  });
}

export async function GET(_req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();

    const rows = await db
      .select({
        ledger: bankrollLedgers,
        analysisName: analyses.name,
        totalOperations: count(bankrollLedgerEntries.id),
        totalProfitLoss: sum(bankrollLedgerEntries.profitLoss),
      })
      .from(bankrollLedgers)
      .innerJoin(analyses, eq(bankrollLedgers.analysisId, analyses.id))
      .leftJoin(bankrollLedgerEntries, eq(bankrollLedgerEntries.ledgerId, bankrollLedgers.id))
      .where(eq(bankrollLedgers.userId, userId))
      .groupBy(bankrollLedgers.id, analyses.name)
      .orderBy(desc(bankrollLedgers.createdAt));

    return NextResponse.json({
      items: rows.map((r) => ({
        ...r.ledger,
        analysisName: r.analysisName,
        totalOperations: r.totalOperations,
        currentBalance: new Decimal(r.ledger.initialBankroll).plus(r.totalProfitLoss ?? "0").toFixed(2),
      })),
    });
  });
}

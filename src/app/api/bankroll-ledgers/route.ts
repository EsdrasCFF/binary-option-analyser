/**
 * POST /api/bankroll-ledgers — cria um gerenciamento de banca MANUAL (a
 * "planilha") vinculado a UMA análise — de período único (`analysisId`) OU
 * Plus (`multiPeriodAnalysisId`), exatamente uma das duas.
 * GET  /api/bankroll-ledgers — lista os gerenciamentos do usuário, com saldo
 * atual e total de operações já agregados.
 *
 * Diferente do Backtest, aqui não roda simulação nenhuma: o usuário escolhe
 * o horário (entre os disponíveis na análise vinculada — TODOS numa análise
 * de período único, só o TOP 20 por Confidence Score numa Análise Plus), o
 * %, a entrada, e MARCA manualmente o resultado — o sistema só calcula o R$
 * de cada linha (`computeEntryProfitLoss`) e o saldo acumulado. Ver
 * `src/lib/core/bankroll-ledger.ts`.
 *
 * Exemplo de body (análise de período único):
 * { "analysisId": "<uuid>", "name": "Gerenciamento manhã", "initialBankroll": "1000" }
 * Exemplo de body (Análise Plus):
 * { "multiPeriodAnalysisId": "<uuid>", "initialBankroll": "1000" }
 */
import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { and, count, desc, eq, sum } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { analyses, bankrollLedgerEntries, bankrollLedgers, multiPeriodAnalyses } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, decimalString, handleErrors, parseJsonBody, uuidString } from "@/lib/api/http";

const bodySchema = z
  .object({
    analysisId: uuidString.optional(),
    multiPeriodAnalysisId: uuidString.optional(),
    name: z.string().trim().min(1).max(60).optional(),
    initialBankroll: decimalString,
  })
  .refine((v) => (v.analysisId !== undefined) !== (v.multiPeriodAnalysisId !== undefined), {
    message: "Informe exatamente um entre analysisId e multiPeriodAnalysisId.",
  });

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const body = await parseJsonBody(req, bodySchema);

    if (Number(body.initialBankroll) <= 0) {
      throw new ApiError("initialBankroll deve ser maior que zero.", 422);
    }

    if (body.analysisId) {
      const [analysis] = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(and(eq(analyses.id, body.analysisId), eq(analyses.userId, userId)))
        .limit(1);
      if (!analysis) throw new ApiError("Análise não encontrada.", 404);
    } else {
      const [analysis] = await db
        .select({ id: multiPeriodAnalyses.id })
        .from(multiPeriodAnalyses)
        .where(and(eq(multiPeriodAnalyses.id, body.multiPeriodAnalysisId!), eq(multiPeriodAnalyses.userId, userId)))
        .limit(1);
      if (!analysis) throw new ApiError("Análise Plus não encontrada.", 404);
    }

    const [ledger] = await db
      .insert(bankrollLedgers)
      .values({
        userId,
        analysisId: body.analysisId ?? null,
        multiPeriodAnalysisId: body.multiPeriodAnalysisId ?? null,
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
        multiPeriodAnalysisName: multiPeriodAnalyses.name,
        totalOperations: count(bankrollLedgerEntries.id),
        totalProfitLoss: sum(bankrollLedgerEntries.profitLoss),
      })
      .from(bankrollLedgers)
      .leftJoin(analyses, eq(bankrollLedgers.analysisId, analyses.id))
      .leftJoin(multiPeriodAnalyses, eq(bankrollLedgers.multiPeriodAnalysisId, multiPeriodAnalyses.id))
      .leftJoin(bankrollLedgerEntries, eq(bankrollLedgerEntries.ledgerId, bankrollLedgers.id))
      .where(eq(bankrollLedgers.userId, userId))
      .groupBy(bankrollLedgers.id, analyses.name, multiPeriodAnalyses.name)
      .orderBy(desc(bankrollLedgers.createdAt));

    return NextResponse.json({
      items: rows.map((r) => ({
        ...r.ledger,
        analysisName: r.analysisName ?? r.multiPeriodAnalysisName ?? "—",
        analysisType: r.ledger.multiPeriodAnalysisId ? "plus" : "single",
        totalOperations: r.totalOperations,
        currentBalance: new Decimal(r.ledger.initialBankroll).plus(r.totalProfitLoss ?? "0").toFixed(2),
      })),
    });
  });
}

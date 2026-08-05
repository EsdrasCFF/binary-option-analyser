/**
 * POST /api/backtests — cria um backtest, valida os padrões selecionados
 * pertencem ao usuário e executa a simulação (motor de `src/lib/backtest`).
 * GET  /api/backtests — lista os backtests do usuário.
 *
 * Exemplo de body:
 * {
 *   "patternResultIds": ["<uuid>"],
 *   "entryStrategy": "same_direction",
 *   "payoutPct": "85",
 *   "initialBankroll": "1000",
 *   "initialEntry": "5.00",
 *   "minProfit": "1.00",
 *   "martingaleLevels": 2,
 *   "periodStart": "2026-01-01T00:00:00Z",
 *   "periodEnd": "2026-02-01T00:00:00Z"
 * }
 *
 * Nota (Fase 4): assim como `/api/analyses`, o processamento roda dentro do
 * request. `?process=false` cria o registro sem executar, para a migração à
 * fila assíncrona.
 */
import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { analyses, backtests, patternResults } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import {
  ApiError,
  decimalString,
  handleErrors,
  isoDateTimeString,
  parseJsonBody,
  uuidString,
} from "@/lib/api/http";
import { processBacktest } from "@/lib/backtest/backtest-service";

const bodySchema = z
  .object({
    patternResultIds: z.array(uuidString).min(1).max(200),
    entryStrategy: z.enum(["same_direction", "contrarian"]).default("same_direction"),
    payoutPct: decimalString,
    initialBankroll: decimalString,
    initialEntry: decimalString,
    minProfit: decimalString,
    martingaleLevels: z.number().int().min(0).max(5).default(0),
    maxExposureLimit: decimalString.optional(),
    dailyLossLimit: decimalString.optional(),
    maxOperationsPerDay: z.number().int().min(1).max(1000).optional(),
    dojiPolicy: z.enum(["ignore", "count_as_loss", "count_as_tie"]).default("ignore"),
    oneEntryPerTimeSlot: z.boolean().default(true),
    periodStart: isoDateTimeString,
    periodEnd: isoDateTimeString,
  })
  .refine((v) => Date.parse(v.periodStart) < Date.parse(v.periodEnd), {
    message: "periodStart deve ser anterior a periodEnd.",
  });

/** Regras de negócio que o Zod não expressa (comparações entre campos monetários). */
function assertConsistentParameters(body: z.infer<typeof bodySchema>): void {
  const payout = new Decimal(body.payoutPct);
  if (payout.lte(0) || payout.gt(100)) {
    throw new ApiError("payoutPct deve estar entre 0 (exclusivo) e 100.", 422);
  }
  const bankroll = new Decimal(body.initialBankroll);
  const entry = new Decimal(body.initialEntry);
  if (bankroll.lte(0)) throw new ApiError("initialBankroll deve ser maior que zero.", 422);
  if (entry.lte(0)) throw new ApiError("initialEntry deve ser maior que zero.", 422);
  if (entry.gt(bankroll)) {
    throw new ApiError("initialEntry não pode ser maior que initialBankroll.", 422);
  }
  if (new Decimal(body.minProfit).lte(0)) {
    throw new ApiError("minProfit deve ser maior que zero.", 422);
  }
  if (body.maxExposureLimit && new Decimal(body.maxExposureLimit).gt(bankroll)) {
    throw new ApiError("maxExposureLimit não pode ser maior que initialBankroll.", 422);
  }
}

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const body = await parseJsonBody(req, bodySchema);
    assertConsistentParameters(body);

    // os padrões selecionados precisam pertencer a análises deste usuário
    const uniqueIds = Array.from(new Set(body.patternResultIds));
    const owned = await db
      .select({ id: patternResults.id })
      .from(patternResults)
      .innerJoin(analyses, eq(patternResults.analysisId, analyses.id))
      .where(and(inArray(patternResults.id, uniqueIds), eq(analyses.userId, userId)));

    if (owned.length !== uniqueIds.length) {
      throw new ApiError(
        "Um ou mais patternResultIds não existem ou não pertencem a este usuário.",
        404
      );
    }

    const [backtest] = await db
      .insert(backtests)
      .values({
        userId,
        patternResultIds: uniqueIds,
        entryStrategy: body.entryStrategy,
        payoutPct: body.payoutPct,
        initialBankroll: body.initialBankroll,
        initialEntry: body.initialEntry,
        minProfit: body.minProfit,
        martingaleLevels: body.martingaleLevels,
        maxExposureLimit: body.maxExposureLimit ?? null,
        dailyLossLimit: body.dailyLossLimit ?? null,
        maxOperationsPerDay: body.maxOperationsPerDay ?? null,
        dojiPolicy: body.dojiPolicy,
        oneEntryPerTimeSlot: body.oneEntryPerTimeSlot,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
        status: "pending",
      })
      .returning();

    const shouldProcess = new URL(req.url).searchParams.get("process") !== "false";
    if (!shouldProcess) {
      return NextResponse.json({ backtest, processed: false }, { status: 201 });
    }

    const result = await processBacktest(backtest.id);
    const [updated] = await db.select().from(backtests).where(eq(backtests.id, backtest.id)).limit(1);

    return NextResponse.json({ backtest: updated, processed: true, ...result }, { status: 201 });
  });
}

export async function GET(_req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const items = await db
      .select()
      .from(backtests)
      .where(eq(backtests.userId, userId))
      .orderBy(desc(backtests.createdAt));
    return NextResponse.json({ items });
  });
}

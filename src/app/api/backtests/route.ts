/**
 * POST /api/backtests — cria um backtest e executa a simulação (motor de
 * `src/lib/backtest`). GET /api/backtests — lista os backtests do usuário.
 *
 * `patternResultIds` são os horários escolhidos na tela de ranking de UMA
 * análise (todos precisam vir da mesma análise — é de lá que o motor tira o
 * escopo usado para redescobrir os melhores horários a cada dia simulado).
 * A quantidade escolhida define os níveis de Martingale (`martingaleLevels =
 * patternResultIds.length - 1`) — não é mais um parâmetro solto: a escada do
 * dia é sempre "o horário mais cedo, o segundo mais cedo, ..." entre os N
 * horários mais fortes daquele dia, não os candles seguintes de um único
 * horário fixo. Ver `src/lib/backtest/run-backtest.ts` para o mecanismo.
 *
 * Exemplo de body:
 * {
 *   "patternResultIds": ["<uuid>", "<uuid>", "<uuid>", "<uuid>"],
 *   "entryStrategy": "contrarian",
 *   "payoutPct": "85",
 *   "initialBankroll": "1000",
 *   "maxExposurePct": "20",
 *   "periodStart": "2026-01-01T00:00:00Z",
 *   "periodEnd": "2026-02-01T00:00:00Z"
 * }
 *
 * `maxExposurePct` é o único parâmetro de risco: entrada inicial e lucro
 * mínimo de recuperação são derivados automaticamente (ver
 * `calculateAutoRecovery` em `src/lib/core/martingale-calculator.ts`), usando
 * o máximo possível desse percentual da banca em cada dia simulado.
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
import { MAX_MARTINGALE_LEVELS } from "@/lib/core/martingale-calculator";
import { processBacktest } from "@/lib/backtest/backtest-service";

const bodySchema = z
  .object({
    patternResultIds: z.array(uuidString).min(1).max(MAX_MARTINGALE_LEVELS + 1),
    entryStrategy: z.enum(["same_direction", "contrarian"]).default("same_direction"),
    payoutPct: decimalString,
    initialBankroll: decimalString,
    maxExposurePct: decimalString,
    dojiPolicy: z.enum(["ignore", "count_as_loss", "count_as_tie"]).default("ignore"),
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
  if (bankroll.lte(0)) throw new ApiError("initialBankroll deve ser maior que zero.", 422);
  const maxExposurePct = new Decimal(body.maxExposurePct);
  if (maxExposurePct.lte(0) || maxExposurePct.gt(100)) {
    throw new ApiError("maxExposurePct deve estar entre 0 (exclusivo) e 100.", 422);
  }
}

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const body = await parseJsonBody(req, bodySchema);
    assertConsistentParameters(body);

    // os padrões selecionados precisam pertencer ao usuário e TODOS à mesma análise
    // (é de lá que vem o escopo usado pra redescobrir os melhores horários a cada dia)
    const uniqueIds = Array.from(new Set(body.patternResultIds));
    const owned = await db
      .select({ id: patternResults.id, analysisId: patternResults.analysisId })
      .from(patternResults)
      .innerJoin(analyses, eq(patternResults.analysisId, analyses.id))
      .where(and(inArray(patternResults.id, uniqueIds), eq(analyses.userId, userId)));

    if (owned.length !== uniqueIds.length) {
      throw new ApiError(
        "Um ou mais patternResultIds não existem ou não pertencem a este usuário.",
        404
      );
    }
    const distinctAnalyses = new Set(owned.map((r) => r.analysisId));
    if (distinctAnalyses.size > 1) {
      throw new ApiError(
        "Todos os horários selecionados precisam vir da mesma análise (cada uma tem seu próprio escopo/limiares).",
        422
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
        maxExposurePct: body.maxExposurePct,
        martingaleLevels: uniqueIds.length - 1,
        dojiPolicy: body.dojiPolicy,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
        status: "pending",
      })
      .returning();

    const shouldProcess = new URL(req.url).searchParams.get("process") !== "false";
    if (!shouldProcess) {
      return NextResponse.json({ backtest, processed: false }, { status: 201 });
    }

    // processBacktest já grava status="error"+errorMessage no próprio backtest
    // ao falhar (ex: sem candles no período pedido) — aqui só evita que essa
    // mensagem, já clara, vire um genérico "Erro interno." (500) por conta de
    // não ser uma ApiError.
    try {
      const result = await processBacktest(backtest.id);
      const [updated] = await db.select().from(backtests).where(eq(backtests.id, backtest.id)).limit(1);
      return NextResponse.json({ backtest: updated, processed: true, ...result }, { status: 201 });
    } catch (e) {
      const [failed] = await db.select().from(backtests).where(eq(backtests.id, backtest.id)).limit(1);
      return NextResponse.json(
        { backtest: failed, processed: true, error: failed?.errorMessage ?? (e as Error).message },
        { status: 201 }
      );
    }
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

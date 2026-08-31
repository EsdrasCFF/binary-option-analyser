/**
 * POST /api/multi-period-analyses — cria uma Análise Plus (MultiPeriodAnalysis
 * + configuração) e dispara o processamento (`src/lib/multi-period`).
 * GET  /api/multi-period-analyses — lista as análises plus do usuário.
 *
 * Duas formas de informar o período (mesmo padrão de `/api/analyses`):
 * - `maxDays`: "últimos N dias a partir de agora" — rolante, referenceDate
 *   vira "agora" a cada (re)processamento.
 * - `startDate`+`endDate`: "período específico" — fixo, `endDate` também
 *   vira a `referenceDate` (não rola com o tempo). `maxDays` é derivado
 *   arredondando o intervalo pra baixo até o múltiplo de 10 mais próximo.
 * Em ambos os casos o motor deriva sozinho as janelas estruturais + a janela
 * de momentum (40D) a partir do `maxDays` resolvido.
 *
 * Exemplo de body (modo "últimos N dias"):
 * {
 *   "name": "AUD/CAD 5m — Análise Plus",
 *   "currencyPairIds": ["<uuid>"],
 *   "timeframe": "5m",
 *   "maxDays": 100,
 *   "startTime": "08:00",
 *   "endTime": "18:00",
 *   "timezone": "America/Sao_Paulo",
 *   "weekdays": [1,2,3,4,5],
 *   "dojiTolerancePct": "0.02",
 *   "dojiPolicy": "ignore",
 *   "persistenceThresholdPct": "70"
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { multiPeriodAnalyses, multiPeriodAnalysisConfigurations, currencyPairs } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, decimalString, handleErrors, isoDateTimeString, parseJsonBody, timeOfDayString, uuidString } from "@/lib/api/http";
import { isValidMaxDays, resolveMaxDaysFromDateRange } from "@/lib/analysis/multi-period-analysis";
import { DEFAULT_SCORING_CONFIG } from "@/lib/core/multi-period-scoring";
import { processMultiPeriodAnalysis } from "@/lib/multi-period/multi-period-service";

const bodySchema = z
  .object({
    name: z.string().min(1).max(255),
    currencyPairIds: z.array(uuidString).min(1),
    timeframe: z.string().min(1).max(10),
    maxDays: z.number().int().min(1).optional(),
    startDate: isoDateTimeString.optional(),
    endDate: isoDateTimeString.optional(),
    startTime: timeOfDayString.optional(),
    endTime: timeOfDayString.optional(),
    timezone: z.string().min(1).max(64).default("UTC"),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    dataProviderId: uuidString.optional(),
    dojiTolerancePct: decimalString.default("0"),
    dojiPolicy: z.enum(["ignore", "count_as_loss", "count_as_tie"]).default("ignore"),
    persistenceThresholdPct: decimalString.default("70"),
  })
  .refine((v) => v.maxDays !== undefined || (v.startDate !== undefined && v.endDate !== undefined), {
    message: "Informe maxDays ou um intervalo (startDate/endDate).",
  })
  .refine((v) => !(v.startDate && v.endDate) || Date.parse(v.startDate) < Date.parse(v.endDate), {
    message: "startDate deve ser anterior a endDate.",
  });

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new ApiError(`Timezone inválido: "${timezone}".`, 400);
  }
}

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const body = await parseJsonBody(req, bodySchema);

    assertValidTimezone(body.timezone);

    let maxDays: number;
    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (body.startDate && body.endDate) {
      startDate = new Date(body.startDate);
      endDate = new Date(body.endDate);
      maxDays = resolveMaxDaysFromDateRange(startDate, endDate);
      if (maxDays < DEFAULT_SCORING_CONFIG.minStructuralDays) {
        const rangeDays = Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
        throw new ApiError(
          `O intervalo escolhido (${rangeDays} dias) é menor que o mínimo necessário (${DEFAULT_SCORING_CONFIG.minStructuralDays} dias) para formar ao menos uma janela estrutural.`,
          422
        );
      }
    } else {
      maxDays = body.maxDays!;
      if (!isValidMaxDays(maxDays, DEFAULT_SCORING_CONFIG.minStructuralDays)) {
        throw new ApiError(
          `maxDays precisa ser múltiplo de 10 e no mínimo ${DEFAULT_SCORING_CONFIG.minStructuralDays} (recebido: ${maxDays}).`,
          422
        );
      }
    }

    const pairs = await db
      .select({ id: currencyPairs.id })
      .from(currencyPairs)
      .where(inArray(currencyPairs.id, body.currencyPairIds));
    if (pairs.length !== new Set(body.currencyPairIds).size) {
      throw new ApiError("Um ou mais currencyPairIds não existem.", 404);
    }

    const [analysis] = await db
      .insert(multiPeriodAnalyses)
      .values({ userId, name: body.name, status: "pending" })
      .returning();

    await db.insert(multiPeriodAnalysisConfigurations).values({
      analysisId: analysis.id,
      currencyPairIds: body.currencyPairIds,
      timeframe: body.timeframe,
      maxDays,
      startDate,
      endDate,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      timezone: body.timezone,
      weekdays: body.weekdays ?? null,
      dataProviderId: body.dataProviderId ?? null,
      dojiTolerancePct: body.dojiTolerancePct,
      dojiPolicy: body.dojiPolicy,
      persistenceThresholdPct: body.persistenceThresholdPct,
    });

    const shouldProcess = new URL(req.url).searchParams.get("process") !== "false";
    if (!shouldProcess) {
      return NextResponse.json({ analysis, processed: false }, { status: 201 });
    }

    try {
      const result = await processMultiPeriodAnalysis(analysis.id);
      const [updated] = await db.select().from(multiPeriodAnalyses).where(eq(multiPeriodAnalyses.id, analysis.id)).limit(1);
      return NextResponse.json({ analysis: updated, processed: true, ...result }, { status: 201 });
    } catch (e) {
      const [failed] = await db.select().from(multiPeriodAnalyses).where(eq(multiPeriodAnalyses.id, analysis.id)).limit(1);
      return NextResponse.json(
        { analysis: failed, processed: true, error: failed?.errorMessage ?? (e as Error).message },
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
      .from(multiPeriodAnalyses)
      .where(eq(multiPeriodAnalyses.userId, userId))
      .orderBy(desc(multiPeriodAnalyses.createdAt));
    return NextResponse.json({ items });
  });
}

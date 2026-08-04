/**
 * POST /api/analyses — cria uma Analysis + AnalysisConfiguration e dispara o
 * processamento (motor de `src/lib/analysis`).
 * GET  /api/analyses — lista as análises do usuário.
 *
 * Exemplo de body:
 * {
 *   "name": "EUR/USD 5m — janeiro",
 *   "currencyPairIds": ["<uuid>"],
 *   "timeframe": "5m",
 *   "historicalDays": 30,
 *   "startTime": "08:00",
 *   "endTime": "18:00",
 *   "timezone": "America/Sao_Paulo",
 *   "minRepetitionPct": "70",
 *   "minValidDays": 20,
 *   "topN": 10,
 *   "weekdays": [1,2,3,4,5],
 *   "dojiTolerancePct": "0.02",
 *   "dojiPolicy": "ignore",
 *   "entryStrategy": "same_direction"
 * }
 *
 * Nota (Fase 4): o processamento roda dentro do request. Para períodos longos
 * isso pode esbarrar no tempo máximo de execução do provedor de deploy — por
 * isso `analyses.status`/`progressPct` já existem e a rota aceita
 * `?process=false` para apenas criar a análise e processá-la depois.
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { analyses, analysisConfigurations, currencyPairs } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { requireUserId } from "@/lib/api/current-user";
import {
  ApiError,
  decimalString,
  handleErrors,
  isoDateTimeString,
  parseJsonBody,
  timeOfDayString,
  uuidString,
} from "@/lib/api/http";
import { processAnalysis } from "@/lib/analysis/analysis-service";

const bodySchema = z
  .object({
    name: z.string().min(1).max(255),
    currencyPairIds: z.array(uuidString).min(1),
    timeframe: z.string().min(1).max(10),
    historicalDays: z.number().int().positive().max(3650).optional(),
    startDate: isoDateTimeString.optional(),
    endDate: isoDateTimeString.optional(),
    startTime: timeOfDayString.optional(),
    endTime: timeOfDayString.optional(),
    timezone: z.string().min(1).max(64).default("UTC"),
    minRepetitionPct: decimalString.default("60"),
    minValidDays: z.number().int().min(1).max(3650).default(20),
    topN: z.number().int().min(1).max(50).default(10),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    dataProviderId: uuidString.optional(),
    entryStrategy: z.enum(["same_direction", "contrarian"]).default("same_direction"),
    dojiTolerancePct: decimalString.default("0"),
    dojiPolicy: z.enum(["ignore", "count_as_loss", "count_as_tie"]).default("ignore"),
  })
  .refine((v) => v.historicalDays !== undefined || v.startDate !== undefined || v.endDate !== undefined, {
    message: "Informe historicalDays ou um intervalo (startDate/endDate).",
  })
  .refine(
    (v) => !(v.startDate && v.endDate) || Date.parse(v.startDate) < Date.parse(v.endDate),
    { message: "startDate deve ser anterior a endDate." }
  );

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new ApiError(`Timezone inválido: "${timezone}".`, 400);
  }
}

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId(req);
    const body = await parseJsonBody(req, bodySchema);

    assertValidTimezone(body.timezone);

    // valida que todos os pares existem antes de criar a análise
    const pairs = await db
      .select({ id: currencyPairs.id })
      .from(currencyPairs)
      .where(inArray(currencyPairs.id, body.currencyPairIds));
    if (pairs.length !== new Set(body.currencyPairIds).size) {
      throw new ApiError("Um ou mais currencyPairIds não existem.", 404);
    }

    const [analysis] = await db
      .insert(analyses)
      .values({ userId, name: body.name, status: "pending" })
      .returning();

    await db.insert(analysisConfigurations).values({
      analysisId: analysis.id,
      currencyPairIds: body.currencyPairIds,
      timeframe: body.timeframe,
      historicalDays: body.historicalDays ?? null,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      timezone: body.timezone,
      minRepetitionPct: body.minRepetitionPct,
      minValidDays: body.minValidDays,
      topN: body.topN,
      weekdays: body.weekdays ?? null,
      dataProviderId: body.dataProviderId ?? null,
      entryStrategy: body.entryStrategy,
      dojiTolerancePct: body.dojiTolerancePct,
      dojiPolicy: body.dojiPolicy,
    });

    const shouldProcess = new URL(req.url).searchParams.get("process") !== "false";
    if (!shouldProcess) {
      return NextResponse.json({ analysis, processed: false }, { status: 201 });
    }

    const result = await processAnalysis(analysis.id);
    const [updated] = await db.select().from(analyses).where(eq(analyses.id, analysis.id)).limit(1);

    return NextResponse.json({ analysis: updated, processed: true, ...result }, { status: 201 });
  });
}

export async function GET(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId(req);
    const items = await db
      .select()
      .from(analyses)
      .where(eq(analyses.userId, userId))
      .orderBy(desc(analyses.createdAt));
    return NextResponse.json({ items });
  });
}

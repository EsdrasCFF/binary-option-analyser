/**
 * GET /api/candles — lista candles brutos de um par+timeframe num intervalo,
 * para a tela de visualização de velas (`/candles`). Diferente das outras
 * rotas de listagem, não pagina por offset — o uso é sempre "um intervalo de
 * datas de cada vez" para um gráfico, então o corte é por `limit` (mais
 * recentes primeiro) com um aviso de truncamento, igual ao padrão já usado na
 * importação do Yahoo Finance quando o pedido excede o disponível.
 *
 * Query params: currencyPairId (obrigatório), timeframe (obrigatório),
 * from, to (ISO, opcionais), timeOfDay ("HH:mm", opcional — filtra só as
 * velas daquele horário, no timezone informado, ex: "17:55" todo dia do
 * intervalo), timezone (default "UTC"), limit (1..5000, default 2000).
 *
 * O filtro por `timeOfDay` é feito em SQL (`AT TIME ZONE`), não em memória —
 * senão, num intervalo largo sem esse filtro, o corte por `limit` já teria
 * descartado a maioria dos candles antes de sobrar algo pra filtrar.
 */
import { NextRequest, NextResponse } from "next/server";
import { SQL, and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { candles as candlesTable, currencyPairs } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import {
  ApiError,
  handleErrors,
  isoDateTimeString,
  parseSearchParams,
  timeOfDayString,
  uuidString,
} from "@/lib/api/http";

const querySchema = z.object({
  currencyPairId: uuidString,
  timeframe: z.string().min(1).max(10),
  from: isoDateTimeString.optional(),
  to: isoDateTimeString.optional(),
  timeOfDay: timeOfDayString.optional(),
  timezone: z.string().min(1).max(64).default("UTC"),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
});

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new ApiError(`Timezone inválido: "${timezone}".`, 400);
  }
}

export async function GET(req: NextRequest) {
  return handleErrors(async () => {
    await requireUserId();
    const q = parseSearchParams(new URL(req.url), querySchema);
    if (q.timeOfDay) assertValidTimezone(q.timezone);

    const [pair] = await db
      .select({ symbol: currencyPairs.symbol })
      .from(currencyPairs)
      .where(eq(currencyPairs.id, q.currencyPairId))
      .limit(1);
    if (!pair) throw new ApiError("Par de moedas não encontrado.", 404);

    const conditions: SQL[] = [
      eq(candlesTable.currencyPairId, q.currencyPairId),
      eq(candlesTable.timeframe, q.timeframe),
    ];
    if (q.from) conditions.push(gte(candlesTable.openTime, new Date(q.from)));
    if (q.to) conditions.push(lte(candlesTable.openTime, new Date(q.to)));
    if (q.timeOfDay) {
      const localTime = sql`(${candlesTable.openTime} AT TIME ZONE ${q.timezone})::time`;
      conditions.push(sql`${localTime} = ${`${q.timeOfDay}:00`}`);
    }
    const where = and(...conditions);

    const [{ value: total }] = await db.select({ value: count() }).from(candlesTable).where(where);

    // mais recentes primeiro pra truncar do jeito mais útil (o fim do
    // intervalo é normalmente o que importa), depois reordena cronológico
    const rows = await db
      .select()
      .from(candlesTable)
      .where(where)
      .orderBy(desc(candlesTable.openTime))
      .limit(q.limit);
    rows.reverse();

    return NextResponse.json({
      items: rows.map((r) => ({
        openTime: r.openTime,
        closeTime: r.closeTime,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      })),
      symbol: pair.symbol,
      total,
      truncated: total > rows.length,
      limit: q.limit,
    });
  });
}

/**
 * GET /api/currency-pairs — lista os pares de moedas conhecidos pelo sistema
 * (criados implicitamente nas importações), com a contagem de candles de cada
 * um e a cobertura (contagem + primeiro/último candle) por timeframe — um
 * mesmo par pode ter janelas de dados bem diferentes por timeframe (ex: 5m
 * importado desde janeiro, 1h só na última semana). Usado para popular os
 * seletores de par nos formulários de Análise e a tela de Pares/Fontes.
 *
 * Não é escopado por usuário: um par de moedas é dado de referência
 * compartilhado (ex: "EUR/USD"), não algo que pertence a um usuário — só os
 * candles/análises/backtests é que pertencem.
 */
import { NextRequest, NextResponse } from "next/server";
import { count, eq, max, min } from "drizzle-orm";
import { db } from "@/db/client";
import { candles, currencyPairs } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { handleErrors } from "@/lib/api/http";

export async function GET(_req: NextRequest) {
  return handleErrors(async () => {
    await requireUserId();

    const pairs = await db.select().from(currencyPairs).orderBy(currencyPairs.symbol);

    const coverage = await db
      .select({
        currencyPairId: candles.currencyPairId,
        timeframe: candles.timeframe,
        candleCount: count(candles.id),
        firstCandle: min(candles.openTime),
        lastCandle: max(candles.openTime),
      })
      .from(candles)
      .groupBy(candles.currencyPairId, candles.timeframe);

    const coverageByPair = new Map<string, typeof coverage>();
    for (const row of coverage) {
      const list = coverageByPair.get(row.currencyPairId) ?? [];
      list.push(row);
      coverageByPair.set(row.currencyPairId, list);
    }

    return NextResponse.json({
      items: pairs.map((pair) => {
        const timeframes = (coverageByPair.get(pair.id) ?? []).sort((a, b) =>
          a.timeframe.localeCompare(b.timeframe)
        );
        return {
          ...pair,
          candleCount: timeframes.reduce((acc, t) => acc + t.candleCount, 0),
          timeframes: timeframes.map((t) => ({
            timeframe: t.timeframe,
            candleCount: t.candleCount,
            firstCandle: t.firstCandle,
            lastCandle: t.lastCandle,
          })),
        };
      }),
    });
  });
}

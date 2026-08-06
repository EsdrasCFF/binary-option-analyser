/**
 * GET /api/currency-pairs — lista os pares de moedas conhecidos pelo sistema
 * (criados implicitamente nas importações), com a contagem de candles de cada
 * um. Usado para popular os seletores de par nos formulários de Análise.
 *
 * Não é escopado por usuário: um par de moedas é dado de referência
 * compartilhado (ex: "EUR/USD"), não algo que pertence a um usuário — só os
 * candles/análises/backtests é que pertencem.
 */
import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { candles, currencyPairs } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { handleErrors } from "@/lib/api/http";

export async function GET(_req: NextRequest) {
  return handleErrors(async () => {
    await requireUserId();

    const rows = await db
      .select({ pair: currencyPairs, candleCount: count(candles.id) })
      .from(currencyPairs)
      .leftJoin(candles, eq(candles.currencyPairId, currencyPairs.id))
      .groupBy(currencyPairs.id)
      .orderBy(currencyPairs.symbol);

    return NextResponse.json({
      items: rows.map((r) => ({ ...r.pair, candleCount: r.candleCount })),
    });
  });
}

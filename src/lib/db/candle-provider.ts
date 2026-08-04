/**
 * Provider de candles lendo do Postgres (Neon), implementando a mesma
 * interface `CandleDataProvider` do `CSVCandleProvider`.
 *
 * Assim o motor de análise não sabe (nem precisa saber) se os candles vieram
 * de um CSV importado, do banco, ou de uma API de corretora no futuro — todos
 * entregam `Candle[]` com Decimal e datas em UTC.
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { candles as candlesTable, currencyPairs } from "@/db/schema";
import { Candle, makeCandle } from "@/lib/core/candle-classifier";
import { CandleDataProvider } from "@/lib/core/data-provider";

export interface DbCandleQuery {
  /** Pares a carregar (ids da tabela currency_pairs). */
  currencyPairIds: string[];
  timeframe: string;
  /** Limites em UTC (inclusive), aplicados sobre open_time. */
  from?: Date;
  to?: Date;
}

export class DbCandleProvider implements CandleDataProvider {
  constructor(private readonly query: DbCandleQuery) {}

  async loadCandles(): Promise<Candle[]> {
    const { currencyPairIds, timeframe, from, to } = this.query;
    if (currencyPairIds.length === 0) return [];

    const conditions = [
      inArray(candlesTable.currencyPairId, currencyPairIds),
      eq(candlesTable.timeframe, timeframe),
    ];
    if (from) conditions.push(gte(candlesTable.openTime, from));
    if (to) conditions.push(lte(candlesTable.openTime, to));

    const rows = await db
      .select({
        symbol: currencyPairs.symbol,
        timeframe: candlesTable.timeframe,
        openTime: candlesTable.openTime,
        closeTime: candlesTable.closeTime,
        open: candlesTable.open,
        high: candlesTable.high,
        low: candlesTable.low,
        close: candlesTable.close,
        volume: candlesTable.volume,
        source: candlesTable.source,
      })
      .from(candlesTable)
      .innerJoin(currencyPairs, eq(candlesTable.currencyPairId, currencyPairs.id))
      .where(and(...conditions))
      .orderBy(asc(candlesTable.openTime));

    // numeric do Postgres volta como string: makeCandle envolve em Decimal.
    return rows.map((r) =>
      makeCandle({
        symbol: r.symbol,
        timeframe: r.timeframe,
        openTime: r.openTime,
        closeTime: r.closeTime,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        source: r.source,
      })
    );
  }
}

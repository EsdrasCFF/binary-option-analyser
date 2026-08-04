/**
 * Resolução de pares de moedas a partir do símbolo normalizado ("EUR/USD").
 *
 * O CSVCandleProvider já normaliza o símbolo; aqui garantimos que exista a
 * linha correspondente em `currency_pairs` (a tabela tem índice único em
 * `symbol`, então o insert é idempotente).
 */
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { currencyPairs } from "@/db/schema";

function splitSymbol(symbol: string): { base: string; quote: string } {
  const [base, quote] = symbol.split("/");
  // símbolos fora do padrão XXX/YYY (ex: índices) ficam sem quote definido
  return { base: base ?? symbol, quote: quote ?? "" };
}

/**
 * Garante a existência dos símbolos informados e devolve o mapa
 * símbolo -> currency_pair_id.
 */
export async function ensureCurrencyPairs(symbols: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(symbols));
  if (unique.length === 0) return new Map();

  await db
    .insert(currencyPairs)
    .values(
      unique.map((symbol) => {
        const { base, quote } = splitSymbol(symbol);
        return { symbol, baseCurrency: base, quoteCurrency: quote };
      })
    )
    .onConflictDoNothing({ target: currencyPairs.symbol });

  const rows = await db
    .select({ id: currencyPairs.id, symbol: currencyPairs.symbol })
    .from(currencyPairs)
    .where(inArray(currencyPairs.symbol, unique));

  return new Map(rows.map((r) => [r.symbol, r.id]));
}

/** Mapa id -> símbolo, para traduzir resultados do motor de volta para o banco. */
export async function loadSymbolsByIds(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({ id: currencyPairs.id, symbol: currencyPairs.symbol })
    .from(currencyPairs)
    .where(inArray(currencyPairs.id, unique));

  return new Map(rows.map((r) => [r.id, r.symbol]));
}

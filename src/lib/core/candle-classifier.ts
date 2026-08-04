/**
 * Classificação de candles em CALL, PUT ou DOJI.
 *
 * Regras:
 * - CALL: close > open
 * - PUT:  close < open
 * - DOJI: |close - open| / open <= tolerância percentual configurada
 *
 * A tolerância de DOJI é sempre relativa (percentual), nunca um valor fixo em
 * pips, porque pares diferentes (ex: EUR/USD vs USD/JPY) têm escalas de preço
 * muito diferentes.
 */
import { Decimal } from "decimal.js";

export enum Direction {
  CALL = "CALL",
  PUT = "PUT",
  DOJI = "DOJI",
}

/** Como um DOJI deve ser tratado nas contagens/backtest. */
export enum DojiPolicy {
  /** não entra na amostra */
  IGNORE = "ignore",
  /** conta como derrota da direção predominante */
  COUNT_AS_LOSS = "count_as_loss",
  /** não conta como vitória nem derrota, mas entra na amostra */
  COUNT_AS_TIE = "count_as_tie",
}

export interface Candle {
  symbol: string;
  timeframe: string; // ex: "5m", "1m", "15m", "1h"
  openTime: Date; // UTC
  closeTime: Date; // UTC
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
  volume: Decimal | null;
  source: string;
}

export function makeCandle(input: {
  symbol: string;
  timeframe: string;
  openTime: Date;
  closeTime: Date;
  open: Decimal.Value;
  high: Decimal.Value;
  low: Decimal.Value;
  close: Decimal.Value;
  volume: Decimal.Value | null;
  source: string;
}): Candle {
  if (input.closeTime.getTime() <= input.openTime.getTime()) {
    throw new Error(
      `Candle ${input.symbol} ${input.openTime.toISOString()}: closeTime deve ser posterior a openTime.`
    );
  }
  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    openTime: input.openTime,
    closeTime: input.closeTime,
    open: new Decimal(input.open),
    high: new Decimal(input.high),
    low: new Decimal(input.low),
    close: new Decimal(input.close),
    volume: input.volume === null ? null : new Decimal(input.volume),
    source: input.source,
  };
}

/**
 * Classifica um candle em CALL, PUT ou DOJI.
 *
 * dojiTolerancePct: ex. new Decimal("0.02") significa 0.02% de variação
 * entre open e close ainda é considerado DOJI. Use Decimal(0) para
 * desativar DOJI (qualquer diferença define CALL/PUT).
 */
export function classifyCandle(candle: Candle, dojiTolerancePct: Decimal): Direction {
  if (candle.open.isZero()) {
    throw new Error(`Candle ${candle.symbol} ${candle.openTime.toISOString()}: open igual a zero.`);
  }

  const diffPct = candle.close.minus(candle.open).abs().div(candle.open).mul(100);

  if (diffPct.lte(dojiTolerancePct)) {
    return Direction.DOJI;
  }
  return candle.close.gt(candle.open) ? Direction.CALL : Direction.PUT;
}

/**
 * Aplica a política de tratamento de DOJI sobre uma lista de direções já
 * classificadas.
 *
 * Retorna { effective, totalValid }:
 * - IGNORE: remove DOJIs da lista e do denominador.
 * - COUNT_AS_LOSS / COUNT_AS_TIE: DOJIs continuam na lista e no denominador;
 *   a diferença semântica entre as duas é aplicada no motor de backtest,
 *   não na contagem estatística.
 */
export function applyDojiPolicy(
  directions: Direction[],
  policy: DojiPolicy
): { effective: Direction[]; totalValid: number } {
  if (policy === DojiPolicy.IGNORE) {
    const effective = directions.filter((d) => d !== Direction.DOJI);
    return { effective, totalValid: effective.length };
  }
  return { effective: directions, totalValid: directions.length };
}

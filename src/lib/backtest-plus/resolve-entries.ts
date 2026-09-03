/**
 * Resolução de uma entrada selecionada (candidato + dia) em
 * WIN/LOSS/TIE/INVALID, olhando a candle real do dia futuro.
 *
 * Reaproveita EXATAMENTE a mesma classificação (`classifyCandle`) e a mesma
 * política de DOJI (`DojiPolicy`) já usadas pelo backtest de período único
 * (`run-backtest.ts`) — nenhuma regra nova é inventada aqui (seção 9/10).
 *
 * INVALID nunca é silenciosamente tratado como LOSS (seção 10/49): candle
 * ausente (`no_data`) ou DOJI sob política IGNORE (`doji`) ficam marcados
 * como INVALID, com o motivo explícito, e são excluídos de win/loss pelas
 * métricas (`metrics.ts`) — não pela resolução em si.
 *
 * A direção esperada de cada candidato já vem CONGELADA no snapshot do pool
 * (seção 2/15/31) — esta função nunca recalcula a Análise Plus original,
 * só compara a direção congelada contra o resultado real observado na
 * candle futura.
 */
import { Decimal } from "decimal.js";
import { Candle, Direction, DojiPolicy, classifyCandle } from "@/lib/core/candle-classifier";
import { localTimeOf } from "@/lib/core/local-time";
import { formatTimeOfDay } from "@/lib/analysis/run-analysis";
import type { BacktestPlusEntryResult, BacktestPlusInvalidReason, PoolCandidate } from "./types";

export interface ResolvedEntry {
  candidateId: string;
  symbol: string;
  timeOfDay: string;
  entryOrder: number; // 1-based, posição dentro do dia
  expectedDirection: "CALL" | "PUT";
  actualDirection: Direction | null; // null quando não há candle (INVALID/no_data)
  result: BacktestPlusEntryResult;
  invalidReason: BacktestPlusInvalidReason | null;
  candle: Candle | null; // OHLC bruto, para auditoria/detalhe na UI
}

function candleKey(symbol: string, day: string, timeOfDay: string): string {
  return `${symbol}|${day}|${timeOfDay}`;
}

/** Índice candle por (symbol, dia local, "HH:mm" local) — mesmo padrão de `indexBySymbolDayTime` em `run-backtest.ts` (primeira ocorrência vence, à prova de DST duplicado). Filtra por timeframe porque o pool pode conter símbolos com timeframes distintos entre si. */
export function indexCandlesForResolution(candles: Candle[], timeframe: string, timezone: string): Map<string, Candle> {
  const map = new Map<string, Candle>();
  for (const c of candles) {
    if (c.timeframe !== timeframe) continue;
    const local = localTimeOf(c, timezone);
    const key = candleKey(c.symbol, local.dateISO, formatTimeOfDay({ hour: local.hour, minute: local.minute }));
    if (!map.has(key)) map.set(key, c);
  }
  return map;
}

function expectedDirectionEnum(direction: "CALL" | "PUT"): Direction {
  return direction === "CALL" ? Direction.CALL : Direction.PUT;
}

export function resolveEntry(
  candidate: PoolCandidate,
  entryOrder: number,
  day: string,
  candleIndex: Map<string, Candle>,
  dojiTolerancePct: Decimal,
  dojiPolicy: DojiPolicy
): ResolvedEntry {
  const base = {
    candidateId: candidate.id,
    symbol: candidate.symbol,
    timeOfDay: candidate.timeOfDay,
    entryOrder,
    expectedDirection: candidate.direction,
  };

  const candle = candleIndex.get(candleKey(candidate.symbol, day, candidate.timeOfDay)) ?? null;
  if (!candle) {
    return { ...base, actualDirection: null, result: "invalid", invalidReason: "no_data", candle: null };
  }

  const actualDirection = classifyCandle(candle, dojiTolerancePct);

  if (actualDirection === Direction.DOJI) {
    if (dojiPolicy === DojiPolicy.IGNORE) {
      return { ...base, actualDirection, result: "invalid", invalidReason: "doji", candle };
    }
    if (dojiPolicy === DojiPolicy.COUNT_AS_TIE) {
      return { ...base, actualDirection, result: "tie", invalidReason: null, candle };
    }
    // COUNT_AS_LOSS: cai no tratamento de derrota abaixo, mesmo comportamento do motor de período único.
  }

  const won = actualDirection === expectedDirectionEnum(candidate.direction);
  return { ...base, actualDirection, result: won ? "win" : "loss", invalidReason: null, candle };
}

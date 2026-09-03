import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { Candle, Direction, DojiPolicy, makeCandle } from "@/lib/core/candle-classifier";
import { indexCandlesForResolution, resolveEntry } from "../resolve-entries";
import type { PoolCandidate } from "../types";

const TIMEFRAME = "5m";

function candle(openTime: Date, direction: Direction, symbol = "EUR/USD"): Candle {
  const open = "1.10000";
  const close = direction === Direction.CALL ? "1.10100" : direction === Direction.PUT ? "1.09900" : open;
  return makeCandle({
    symbol,
    timeframe: TIMEFRAME,
    openTime,
    closeTime: new Date(openTime.getTime() + 5 * 60 * 1000),
    open,
    high: "1.10200",
    low: "1.09800",
    close,
    volume: "100",
    source: "test",
  });
}

function candidate(overrides: Partial<PoolCandidate> = {}): PoolCandidate {
  return { id: "c1", symbol: "EUR/USD", timeOfDay: "10:00", direction: "CALL", confidenceScore: 80, poolRank: 0, ...overrides };
}

describe("resolveEntry", () => {
  it("resolve WIN quando a candle real bate com a direção esperada", () => {
    const c = candle(new Date("2026-01-05T10:00:00Z"), Direction.CALL);
    const index = indexCandlesForResolution([c], TIMEFRAME, "UTC");
    const result = resolveEntry(candidate({ direction: "CALL" }), 1, "2026-01-05", index, new Decimal(0), DojiPolicy.IGNORE);
    expect(result.result).toBe("win");
    expect(result.invalidReason).toBeNull();
    expect(result.candle).not.toBeNull();
  });

  it("resolve LOSS quando a candle real é a direção oposta", () => {
    const c = candle(new Date("2026-01-05T10:00:00Z"), Direction.PUT);
    const index = indexCandlesForResolution([c], TIMEFRAME, "UTC");
    const result = resolveEntry(candidate({ direction: "CALL" }), 1, "2026-01-05", index, new Decimal(0), DojiPolicy.IGNORE);
    expect(result.result).toBe("loss");
  });

  it("resolve INVALID/no_data quando não existe candle pra aquele símbolo/dia/horário", () => {
    const index = indexCandlesForResolution([], TIMEFRAME, "UTC");
    const result = resolveEntry(candidate(), 1, "2026-01-05", index, new Decimal(0), DojiPolicy.IGNORE);
    expect(result.result).toBe("invalid");
    expect(result.invalidReason).toBe("no_data");
    expect(result.candle).toBeNull();
    expect(result.actualDirection).toBeNull();
  });

  it("nunca mascara NO_DATA como LOSS", () => {
    const index = indexCandlesForResolution([], TIMEFRAME, "UTC");
    const result = resolveEntry(candidate(), 1, "2026-01-05", index, new Decimal(0), DojiPolicy.COUNT_AS_LOSS);
    expect(result.result).toBe("invalid");
    expect(result.result).not.toBe("loss");
  });

  describe("política de DOJI — reaproveita exatamente DojiPolicy", () => {
    it("IGNORE: DOJI vira INVALID (não entra na amostra)", () => {
      const c = candle(new Date("2026-01-05T10:00:00Z"), Direction.DOJI);
      const index = indexCandlesForResolution([c], TIMEFRAME, "UTC");
      const result = resolveEntry(candidate(), 1, "2026-01-05", index, new Decimal(100), DojiPolicy.IGNORE);
      expect(result.result).toBe("invalid");
      expect(result.invalidReason).toBe("doji");
    });

    it("COUNT_AS_TIE: DOJI vira TIE", () => {
      const c = candle(new Date("2026-01-05T10:00:00Z"), Direction.DOJI);
      const index = indexCandlesForResolution([c], TIMEFRAME, "UTC");
      const result = resolveEntry(candidate(), 1, "2026-01-05", index, new Decimal(100), DojiPolicy.COUNT_AS_TIE);
      expect(result.result).toBe("tie");
      expect(result.invalidReason).toBeNull();
    });

    it("COUNT_AS_LOSS: DOJI conta como derrota da direção predominante", () => {
      const c = candle(new Date("2026-01-05T10:00:00Z"), Direction.DOJI);
      const index = indexCandlesForResolution([c], TIMEFRAME, "UTC");
      const result = resolveEntry(candidate({ direction: "CALL" }), 1, "2026-01-05", index, new Decimal(100), DojiPolicy.COUNT_AS_LOSS);
      expect(result.result).toBe("loss");
    });
  });

  describe("correção de timezone (crítico — seção 9)", () => {
    it("um candidato às 06:45 no timezone da análise nunca resolve contra a candle das 09:45 UTC", () => {
      // America/Sao_Paulo = UTC-3 (sem horário de verão atualmente): 06:45 local = 09:45 UTC.
      const localTimeCandle = candle(new Date("2026-01-05T09:45:00Z"), Direction.CALL);
      // Uma candle "armadilha" literalmente às 06:45 UTC (que seria 03:45 local) — nunca deve
      // ser confundida com o horário local 06:45 pedido.
      const trapCandle = candle(new Date("2026-01-05T06:45:00Z"), Direction.PUT);

      const index = indexCandlesForResolution([localTimeCandle, trapCandle], TIMEFRAME, "America/Sao_Paulo");
      const result = resolveEntry(
        candidate({ timeOfDay: "06:45", direction: "CALL" }),
        1,
        "2026-01-05",
        index,
        new Decimal(0),
        DojiPolicy.IGNORE
      );

      expect(result.result).toBe("win"); // resolveu contra a candle das 09:45 UTC (06:45 local), não a das 06:45 UTC
      expect(result.candle?.openTime.toISOString()).toBe("2026-01-05T09:45:00.000Z");
    });
  });
});

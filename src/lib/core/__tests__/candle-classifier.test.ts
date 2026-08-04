import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import {
  Direction,
  DojiPolicy,
  makeCandle,
  classifyCandle,
  applyDojiPolicy,
} from "../candle-classifier";

function candle(openPrice: string, closePrice: string) {
  const t0 = new Date("2026-01-01T12:00:00Z");
  const t1 = new Date("2026-01-01T12:05:00Z");
  return makeCandle({
    symbol: "EUR/USD",
    timeframe: "5m",
    openTime: t0,
    closeTime: t1,
    open: openPrice,
    high: openPrice,
    low: closePrice,
    close: closePrice,
    volume: null,
    source: "test",
  });
}

describe("classifyCandle", () => {
  it("CALL quando close > open", () => {
    expect(classifyCandle(candle("1.1000", "1.1010"), new Decimal(0))).toBe(Direction.CALL);
  });

  it("PUT quando close < open", () => {
    expect(classifyCandle(candle("1.1010", "1.1000"), new Decimal(0))).toBe(Direction.PUT);
  });

  it("DOJI dentro da tolerância", () => {
    expect(classifyCandle(candle("1.10000", "1.10001"), new Decimal("0.01"))).toBe(Direction.DOJI);
  });

  it("não é DOJI fora da tolerância", () => {
    expect(classifyCandle(candle("1.10000", "1.10500"), new Decimal("0.01"))).toBe(Direction.CALL);
  });

  it("tolerância zero só gera DOJI se open === close", () => {
    expect(classifyCandle(candle("1.1000", "1.1000"), new Decimal(0))).toBe(Direction.DOJI);
  });

  it("lança erro se closeTime <= openTime", () => {
    expect(() =>
      makeCandle({
        symbol: "EUR/USD",
        timeframe: "5m",
        openTime: new Date("2026-01-01T12:05:00Z"),
        closeTime: new Date("2026-01-01T12:00:00Z"),
        open: "1.1",
        high: "1.1",
        low: "1.1",
        close: "1.1",
        volume: null,
        source: "test",
      })
    ).toThrow();
  });
});

describe("applyDojiPolicy", () => {
  it("IGNORE remove DOJIs da amostra", () => {
    const directions = [Direction.CALL, Direction.DOJI, Direction.PUT, Direction.DOJI];
    const { effective, totalValid } = applyDojiPolicy(directions, DojiPolicy.IGNORE);
    expect(totalValid).toBe(2);
    expect(effective).not.toContain(Direction.DOJI);
  });

  it("COUNT_AS_LOSS mantém DOJI no denominador", () => {
    const directions = [Direction.CALL, Direction.DOJI, Direction.PUT];
    const { effective, totalValid } = applyDojiPolicy(directions, DojiPolicy.COUNT_AS_LOSS);
    expect(totalValid).toBe(3);
    expect(effective).toEqual(directions);
  });
});

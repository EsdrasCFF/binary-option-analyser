import { describe, it, expect } from "vitest";
import { createSeededRandom, randomInt } from "../seeded-random";

describe("createSeededRandom", () => {
  it("é determinístico: o mesmo seed produz exatamente a mesma sequência", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("seeds diferentes produzem sequências diferentes", () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("sempre retorna números em [0, 1)", () => {
    const rng = createSeededRandom(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("reprocessar (recriar o gerador com o mesmo seed) reproduz o mesmo resultado — reabrir o backtest não muda nada", () => {
    const run = (seed: number) => {
      const rng = createSeededRandom(seed);
      return Array.from({ length: 5 }, () => randomInt(rng, 10));
    };
    expect(run(777)).toEqual(run(777));
  });
});

describe("randomInt", () => {
  it("nunca retorna um valor fora de [0, maxExclusive)", () => {
    const rng = createSeededRandom(99);
    for (let i = 0; i < 500; i++) {
      const v = randomInt(rng, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

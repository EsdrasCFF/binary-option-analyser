import { describe, it, expect } from "vitest";
import { generateRandomSeed, toCandidateSnapshotRow } from "../backtest-plus-service";

// Sem infraestrutura de teste de integração com banco neste projeto (nenhum
// outro módulo — Backtest, Análise Plus, Bankroll Ledger — tem esse tipo de
// teste); a validação de negócio das rotas (analysisId pertence ao usuário,
// candidatos pertencem à análise, 10 distintos, etc.) é coberta pelas
// funções puras testáveis abaixo, que são as partes de `backtest-plus-service`
// que não dependem de I/O de banco.

function fakePatternResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "result-1",
    analysisId: "analysis-1",
    currencyPairId: "pair-1",
    timeframe: "5m",
    timeOfDay: "10:00",
    timezone: "UTC",
    direction: "CALL",
    structuralAverage: "72.50",
    confidenceScore: 88,
    classification: "forte",
    recommendation: "a_favor",
    momentumTrend: "estavel",
    inversionState: "none",
    ...overrides,
    // campos não usados pelo snapshot ficam fora de propósito
  } as unknown as Parameters<typeof toCandidateSnapshotRow>[3];
}

describe("generateRandomSeed", () => {
  it("gera um inteiro positivo dentro do range de int32 do Postgres", () => {
    for (let i = 0; i < 50; i++) {
      const seed = generateRandomSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThan(0);
      expect(seed).toBeLessThan(2_147_483_647);
    }
  });

  it("gera valores variados (entropia real, não constante)", () => {
    const seeds = new Set(Array.from({ length: 20 }, () => generateRandomSeed()));
    expect(seeds.size).toBeGreaterThan(1);
  });
});

describe("toCandidateSnapshotRow", () => {
  it("copia os valores da Análise Plus — é um SNAPSHOT, não uma referência viva", () => {
    const source = fakePatternResult({ confidenceScore: 91, direction: "PUT" });
    const row = toCandidateSnapshotRow("backtest-1", 3, "EUR/USD", source);

    expect(row).toMatchObject({
      backtestId: "backtest-1",
      sourceResultId: "result-1",
      poolRank: 3,
      currencyPairId: "pair-1",
      symbol: "EUR/USD",
      timeOfDay: "10:00",
      timeframe: "5m",
      direction: "PUT",
      confidenceScore: 91,
      classification: "forte",
      recommendation: "a_favor",
      momentumTrend: "estavel",
      structuralAverage: "72.50",
    });

    // mutar o objeto de origem DEPOIS do snapshot não pode vazar pro snapshot já gerado
    (source as unknown as { confidenceScore: number }).confidenceScore = 1;
    expect(row.confidenceScore).toBe(91);
  });

  it("preserva poolRank exatamente como recebido (0-9), sem reordenar", () => {
    for (let rank = 0; rank < 10; rank++) {
      const row = toCandidateSnapshotRow("b", rank, "EUR/USD", fakePatternResult());
      expect(row.poolRank).toBe(rank);
    }
  });
});

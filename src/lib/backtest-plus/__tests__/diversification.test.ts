import { describe, it, expect } from "vitest";
import { extractCurrencies, minutesBetween, computeAdjustedScore, DEFAULT_DIVERSIFICATION_CONFIG } from "../diversification";
import type { PoolCandidate } from "../types";

function candidate(overrides: Partial<PoolCandidate> = {}): PoolCandidate {
  return { id: "c1", symbol: "EUR/USD", timeOfDay: "10:00", direction: "CALL", confidenceScore: 80, poolRank: 0, ...overrides };
}

describe("extractCurrencies", () => {
  it("separa base e quote de um símbolo padrão", () => {
    expect(extractCurrencies("EUR/USD")).toEqual({ base: "EUR", quote: "USD" });
  });
});

describe("minutesBetween", () => {
  it("calcula a distância absoluta em minutos entre dois horários", () => {
    expect(minutesBetween("10:00", "10:30")).toBe(30);
    expect(minutesBetween("10:30", "10:00")).toBe(30);
    expect(minutesBetween("09:00", "11:00")).toBe(120);
    expect(minutesBetween("10:00", "10:00")).toBe(0);
  });
});

describe("computeAdjustedScore", () => {
  it("não penaliza quando não há entradas selecionadas ainda", () => {
    const c = candidate({ confidenceScore: 90 });
    expect(computeAdjustedScore(c, [])).toBe(90);
  });

  it("penaliza por cada moeda compartilhada com uma entrada já selecionada", () => {
    // horários bem distantes um do outro pra isolar só a penalização de moeda
    const candidateEurUsd = candidate({ symbol: "EUR/USD", timeOfDay: "10:00", confidenceScore: 90 });
    const selectedGbpUsd = candidate({ id: "s1", symbol: "GBP/USD", timeOfDay: "18:00" });
    // compartilha USD -> 1 moeda em comum
    const adjusted = computeAdjustedScore(candidateEurUsd, [selectedGbpUsd]);
    expect(adjusted).toBe(90 - DEFAULT_DIVERSIFICATION_CONFIG.currencyOverlapPenaltyPerShare);
  });

  it("penaliza duas vezes quando AMBAS as moedas coincidem com uma entrada já selecionada", () => {
    const candidateEurUsd = candidate({ symbol: "EUR/USD", timeOfDay: "10:00", confidenceScore: 90 });
    const selectedUsdEur = candidate({ id: "s1", symbol: "USD/EUR", timeOfDay: "18:00" });
    const adjusted = computeAdjustedScore(candidateEurUsd, [selectedUsdEur]);
    expect(adjusted).toBe(90 - 2 * DEFAULT_DIVERSIFICATION_CONFIG.currencyOverlapPenaltyPerShare);
  });

  it("penaliza horários próximos demais (dentro do threshold)", () => {
    const candidateAt = candidate({ symbol: "EUR/USD", timeOfDay: "10:00", confidenceScore: 90 });
    const selectedClose = candidate({ id: "s1", symbol: "GBP/JPY", timeOfDay: "10:10" });
    const adjusted = computeAdjustedScore(candidateAt, [selectedClose]);
    expect(adjusted).toBe(90 - DEFAULT_DIVERSIFICATION_CONFIG.closeTimePenalty);
  });

  it("não penaliza horários fora do threshold de proximidade", () => {
    const candidateAt = candidate({ symbol: "EUR/USD", timeOfDay: "10:00", confidenceScore: 90 });
    const selectedFar = candidate({ id: "s1", symbol: "GBP/JPY", timeOfDay: "12:00" });
    expect(computeAdjustedScore(candidateAt, [selectedFar])).toBe(90);
  });

  it("acumula as penalizações de moeda e de horário quando ambas se aplicam", () => {
    const candidateAt = candidate({ symbol: "EUR/USD", timeOfDay: "10:00", confidenceScore: 90 });
    const selected = candidate({ id: "s1", symbol: "GBP/USD", timeOfDay: "10:05" });
    const adjusted = computeAdjustedScore(candidateAt, [selected]);
    expect(adjusted).toBe(
      90 - DEFAULT_DIVERSIFICATION_CONFIG.currencyOverlapPenaltyPerShare - DEFAULT_DIVERSIFICATION_CONFIG.closeTimePenalty
    );
  });
});

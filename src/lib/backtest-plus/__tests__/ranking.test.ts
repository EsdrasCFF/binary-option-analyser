import { describe, it, expect } from "vitest";
import { rankModels, type RankableModel } from "../ranking";
import type { ModelMetrics } from "../metrics";

function metrics(overrides: Partial<ModelMetrics> = {}): ModelMetrics {
  return {
    daysTested: 10,
    daysConsidered: 10,
    daysExcludedNoData: 0,
    successfulDays: 5,
    failedDays: 5,
    zeroOfN: 5,
    dailySuccessRate: 0.5,
    zeroOfNRate: 0.5,
    totalEntries: 50,
    totalWins: 20,
    totalLosses: 30,
    totalTies: 0,
    invalidEntries: 0,
    individualHitRate: 0.4,
    averageEntriesUntilFirstWin: 2,
    medianEntriesUntilFirstWin: 2,
    firstWinAt: [1, 1, 1, 1, 1],
    coverageAt: [0.2, 0.4, 0.6, 0.8, 1],
    ...overrides,
  };
}

describe("rankModels", () => {
  it("ordena primariamente por MENOR zeroOfNRate, não por totalWins", () => {
    const models: RankableModel[] = [
      { model: "top_score", metrics: metrics({ zeroOfNRate: 0.5, totalWins: 100 }) },
      { model: "random", metrics: metrics({ zeroOfNRate: 0.1, totalWins: 10 }) },
    ];
    const ranked = rankModels(models);
    expect(ranked[0].model).toBe("random"); // menos vitórias totais, mas muito menos 0/N: vence
  });

  it("desempata por maior dailySuccessRate quando zeroOfNRate empata", () => {
    const models: RankableModel[] = [
      { model: "top_score", metrics: metrics({ zeroOfNRate: 0.2, dailySuccessRate: 0.6 }) },
      { model: "rotation", metrics: metrics({ zeroOfNRate: 0.2, dailySuccessRate: 0.8 }) },
    ];
    expect(rankModels(models)[0].model).toBe("rotation");
  });

  it("desempata por maior individualHitRate no 3º nível", () => {
    const models: RankableModel[] = [
      { model: "top_score", metrics: metrics({ zeroOfNRate: 0.2, dailySuccessRate: 0.6, individualHitRate: 0.3 }) },
      { model: "rotation", metrics: metrics({ zeroOfNRate: 0.2, dailySuccessRate: 0.6, individualHitRate: 0.5 }) },
    ];
    expect(rankModels(models)[0].model).toBe("rotation");
  });

  it("desempata por menor averageEntriesUntilFirstWin no 4º nível, tratando null como pior", () => {
    const models: RankableModel[] = [
      { model: "top_score", metrics: metrics({ zeroOfNRate: 0.2, dailySuccessRate: 0.6, individualHitRate: 0.3, averageEntriesUntilFirstWin: null }) },
      { model: "rotation", metrics: metrics({ zeroOfNRate: 0.2, dailySuccessRate: 0.6, individualHitRate: 0.3, averageEntriesUntilFirstWin: 1.5 }) },
    ];
    expect(rankModels(models)[0].model).toBe("rotation");
  });

  it("desempata por maior totalWins como último critério", () => {
    const models: RankableModel[] = [
      {
        model: "top_score",
        metrics: metrics({ zeroOfNRate: 0.2, dailySuccessRate: 0.6, individualHitRate: 0.3, averageEntriesUntilFirstWin: 1.5, totalWins: 10 }),
      },
      {
        model: "rotation",
        metrics: metrics({ zeroOfNRate: 0.2, dailySuccessRate: 0.6, individualHitRate: 0.3, averageEntriesUntilFirstWin: 1.5, totalWins: 20 }),
      },
    ];
    expect(rankModels(models)[0].model).toBe("rotation");
  });

  it("não muta o array recebido", () => {
    const models: RankableModel[] = [
      { model: "top_score", metrics: metrics({ zeroOfNRate: 0.5 }) },
      { model: "random", metrics: metrics({ zeroOfNRate: 0.1 }) },
    ];
    const original = [...models];
    rankModels(models);
    expect(models).toEqual(original);
  });
});

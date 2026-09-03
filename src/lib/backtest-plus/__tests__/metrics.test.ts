import { describe, it, expect } from "vitest";
import { aggregateMetrics, type DayOutcome } from "../metrics";

function day(date: string, results: Array<"win" | "loss" | "tie" | "invalid">): DayOutcome {
  return { date, entries: results.map((result, i) => ({ entryOrder: i + 1, result })) };
}

describe("aggregateMetrics — exemplo trabalhado (3 dias, 5 entradas/dia)", () => {
  // Dia 1: L W L W W -> primeiro win na posição 2
  // Dia 2: W L L L W -> primeiro win na posição 1
  // Dia 3: L L L L L -> 0/N (nenhum win)
  const days: DayOutcome[] = [
    day("2026-01-05", ["loss", "win", "loss", "win", "win"]),
    day("2026-01-06", ["win", "loss", "loss", "loss", "win"]),
    day("2026-01-07", ["loss", "loss", "loss", "loss", "loss"]),
  ];
  const metrics = aggregateMetrics(days, 5);

  it("conta dias testados, bem-sucedidos e 0/N corretamente", () => {
    expect(metrics.daysTested).toBe(3);
    expect(metrics.daysConsidered).toBe(3);
    expect(metrics.successfulDays).toBe(2);
    expect(metrics.failedDays).toBe(1);
    expect(metrics.zeroOfN).toBe(1);
  });

  it("calcula as taxas diárias", () => {
    expect(metrics.dailySuccessRate).toBeCloseTo(2 / 3, 10);
    expect(metrics.zeroOfNRate).toBeCloseTo(1 / 3, 10);
  });

  it("conta vitórias/derrotas totais e a taxa individual de acerto", () => {
    expect(metrics.totalWins).toBe(5); // dia1: pos2,4,5 / dia2: pos1,5
    expect(metrics.totalLosses).toBe(10); // dia1: pos1,3 / dia2: pos2,3,4 / dia3: todas as 5
    expect(metrics.individualHitRate).toBeCloseTo(5 / 15, 10);
  });

  it("distribui firstWinAt e coverageAt corretamente (posição 1-indexada)", () => {
    expect(metrics.firstWinAt[0]).toBe(1); // posição 1: dia2
    expect(metrics.firstWinAt[1]).toBe(1); // posição 2: dia1
    expect(metrics.firstWinAt[2]).toBe(0);
    expect(metrics.coverageAt[0]).toBeCloseTo(1 / 3, 10); // até a posição 1
    expect(metrics.coverageAt[1]).toBeCloseTo(2 / 3, 10); // até a posição 2
    expect(metrics.coverageAt[2]).toBeCloseTo(2 / 3, 10); // monotônico: não decresce sem novo win
    expect(metrics.coverageAt[3]).toBeCloseTo(2 / 3, 10);
    expect(metrics.coverageAt[4]).toBeCloseTo(2 / 3, 10);
  });

  it("calcula a média de entradas até o primeiro win só sobre dias com vitória", () => {
    // dia1 venceu na posição 2, dia2 venceu na posição 1 -> média (2+1)/2 = 1.5
    expect(metrics.averageEntriesUntilFirstWin).toBeCloseTo(1.5, 10);
    expect(metrics.medianEntriesUntilFirstWin).toBeCloseTo(1.5, 10);
  });
});

describe("aggregateMetrics — casos de borda", () => {
  it("retorna tudo zerado quando não há dias", () => {
    const metrics = aggregateMetrics([], 5);
    expect(metrics.daysTested).toBe(0);
    expect(metrics.dailySuccessRate).toBe(0);
    expect(metrics.zeroOfNRate).toBe(0);
    expect(metrics.averageEntriesUntilFirstWin).toBeNull();
    expect(metrics.medianEntriesUntilFirstWin).toBeNull();
  });

  it("um dia inteiramente INVALID não conta como sucesso nem como 0/N, mas é reportado em daysExcludedNoData", () => {
    const days: DayOutcome[] = [day("2026-01-05", ["invalid", "invalid", "invalid", "invalid", "invalid"])];
    const metrics = aggregateMetrics(days, 5);
    expect(metrics.daysTested).toBe(1);
    expect(metrics.daysExcludedNoData).toBe(1);
    expect(metrics.daysConsidered).toBe(0);
    expect(metrics.successfulDays).toBe(0);
    expect(metrics.failedDays).toBe(0);
    expect(metrics.zeroOfNRate).toBe(0); // sem denominador, não fica NaN nem mascara como derrota
    expect(metrics.invalidEntries).toBe(5);
  });

  it("um dia com mistura de INVALID e resultados reais ainda conta normalmente, excluindo só o INVALID de win/loss", () => {
    const days: DayOutcome[] = [day("2026-01-05", ["invalid", "loss", "loss", "loss", "win"])];
    const metrics = aggregateMetrics(days, 5);
    expect(metrics.daysConsidered).toBe(1);
    expect(metrics.successfulDays).toBe(1);
    expect(metrics.invalidEntries).toBe(1);
    expect(metrics.firstWinAt[4]).toBe(1); // win na posição 5
    expect(metrics.totalWins).toBe(1);
    expect(metrics.totalLosses).toBe(3);
  });

  it("TIE não conta como win nem loss e é excluído do denominador de individualHitRate", () => {
    const days: DayOutcome[] = [day("2026-01-05", ["tie", "loss", "win", "loss", "tie"])];
    const metrics = aggregateMetrics(days, 5);
    expect(metrics.totalTies).toBe(2);
    expect(metrics.individualHitRate).toBeCloseTo(1 / 3, 10); // 1 win / (1 win + 2 loss)
  });

  it("funciona com entriesPerDay=4", () => {
    const days: DayOutcome[] = [day("2026-01-05", ["loss", "loss", "win", "loss"])];
    const metrics = aggregateMetrics(days, 4);
    expect(metrics.firstWinAt).toHaveLength(4);
    expect(metrics.coverageAt).toHaveLength(4);
    expect(metrics.firstWinAt[2]).toBe(1);
    expect(metrics.coverageAt[3]).toBeCloseTo(1, 10);
  });
});

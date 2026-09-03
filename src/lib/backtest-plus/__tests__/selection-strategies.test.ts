import { describe, it, expect } from "vitest";
import { createSeededRandom } from "../seeded-random";
import { selectCandidates, type SelectionContext } from "../selection-strategies";
import type { PoolCandidate } from "../types";

function pool(): PoolCandidate[] {
  // 10 candidatos com scores e horários variados, símbolos deliberadamente
  // sobrepostos em moeda pra exercitar o modelo DIVERSIFIED.
  return [
    { id: "0", symbol: "EUR/USD", timeOfDay: "07:00", direction: "CALL", confidenceScore: 95, poolRank: 0 },
    { id: "1", symbol: "GBP/USD", timeOfDay: "07:10", direction: "CALL", confidenceScore: 93, poolRank: 1 },
    { id: "2", symbol: "USD/JPY", timeOfDay: "08:00", direction: "PUT", confidenceScore: 90, poolRank: 2 },
    { id: "3", symbol: "EUR/GBP", timeOfDay: "09:00", direction: "CALL", confidenceScore: 88, poolRank: 3 },
    { id: "4", symbol: "AUD/USD", timeOfDay: "10:00", direction: "PUT", confidenceScore: 85, poolRank: 4 },
    { id: "5", symbol: "USD/CAD", timeOfDay: "11:00", direction: "CALL", confidenceScore: 80, poolRank: 5 },
    { id: "6", symbol: "NZD/USD", timeOfDay: "12:00", direction: "PUT", confidenceScore: 75, poolRank: 6 },
    { id: "7", symbol: "EUR/JPY", timeOfDay: "13:00", direction: "CALL", confidenceScore: 70, poolRank: 7 },
    { id: "8", symbol: "GBP/JPY", timeOfDay: "14:00", direction: "PUT", confidenceScore: 65, poolRank: 8 },
    { id: "9", symbol: "CHF/JPY", timeOfDay: "15:00", direction: "CALL", confidenceScore: 60, poolRank: 9 },
  ];
}

function ctx(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return { rng: createSeededRandom(1), usageCount: new Map(), ...overrides };
}

describe("TOP_SCORE", () => {
  it("é determinístico e sempre escolhe os N maiores scores, sem aleatoriedade", () => {
    const p = pool();
    const a = selectCandidates("top_score", p, 5, ctx());
    const b = selectCandidates("top_score", p, 5, ctx({ rng: createSeededRandom(999) }));
    expect(a.map((c) => c.id)).toEqual(["0", "1", "2", "3", "4"]);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it("desempata por poolRank quando os scores são iguais", () => {
    const p = pool().map((c) => ({ ...c, confidenceScore: 50 }));
    const selected = selectCandidates("top_score", p, 3, ctx());
    expect(selected.map((c) => c.id)).toEqual(["0", "1", "2"]);
  });
});

describe("RANDOM", () => {
  it("é reprodutível: o mesmo seed produz exatamente a mesma seleção", () => {
    const p = pool();
    const a = selectCandidates("random", p, 5, ctx({ rng: createSeededRandom(42) }));
    const b = selectCandidates("random", p, 5, ctx({ rng: createSeededRandom(42) }));
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it("nunca repete um candidato dentro do mesmo dia", () => {
    const p = pool();
    const selected = selectCandidates("random", p, 5, ctx({ rng: createSeededRandom(7) }));
    const ids = selected.map((c) => c.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("seeds diferentes tendem a produzir seleções diferentes", () => {
    const p = pool();
    const a = selectCandidates("random", p, 5, ctx({ rng: createSeededRandom(1) }));
    const b = selectCandidates("random", p, 5, ctx({ rng: createSeededRandom(2) }));
    expect(a.map((c) => c.id)).not.toEqual(b.map((c) => c.id));
  });
});

describe("ROTATION", () => {
  it("prioriza quem foi menos usado até agora", () => {
    const p = pool();
    const usageCount = new Map([
      ["0", 3],
      ["1", 3],
      ["2", 0],
      ["3", 0],
    ]);
    const selected = selectCandidates("rotation", p, 2, ctx({ usageCount }));
    expect(selected.map((c) => c.id)).toEqual(["2", "3"]);
  });

  it("desempata por maior score e depois por poolRank, de forma determinística", () => {
    const p = pool();
    const a = selectCandidates("rotation", p, 3, ctx({ usageCount: new Map() }));
    const b = selectCandidates("rotation", p, 3, ctx({ usageCount: new Map() }));
    expect(a.map((c) => c.id)).toEqual(["0", "1", "2"]); // sem uso: cai pro desempate de maior score
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it("rotaciona ao longo de dias sucessivos quando o chamador atualiza usageCount", () => {
    const p = pool().slice(0, 4); // pool pequeno pra forçar reuso
    const usageCount = new Map<string, number>();
    const daysSelected: string[][] = [];
    for (let day = 0; day < 4; day++) {
      const selected = selectCandidates("rotation", p, 2, ctx({ usageCount }));
      daysSelected.push(selected.map((c) => c.id));
      for (const c of selected) usageCount.set(c.id, (usageCount.get(c.id) ?? 0) + 1);
    }
    // com pool de 4 e 2 por dia, em 4 dias cada candidato deve ter sido usado exatamente 2 vezes
    const finalUsage = [...usageCount.values()];
    expect(finalUsage.every((v) => v === 2)).toBe(true);
  });
});

describe("WEIGHTED_SCORE", () => {
  it("é reprodutível: o mesmo seed produz a mesma seleção", () => {
    const p = pool();
    const a = selectCandidates("weighted_score", p, 5, ctx({ rng: createSeededRandom(123) }));
    const b = selectCandidates("weighted_score", p, 5, ctx({ rng: createSeededRandom(123) }));
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it("nunca repete um candidato dentro do mesmo dia (amostragem sem reposição)", () => {
    const p = pool();
    const selected = selectCandidates("weighted_score", p, 5, ctx({ rng: createSeededRandom(55) }));
    expect(new Set(selected.map((c) => c.id)).size).toBe(5);
  });

  it("consegue selecionar o pool inteiro sem erro quando count === pool.length", () => {
    const p = pool();
    const selected = selectCandidates("weighted_score", p, 10, ctx({ rng: createSeededRandom(9) }));
    expect(selected).toHaveLength(10);
  });
});

describe("DIVERSIFIED", () => {
  it("é totalmente determinístico (sem aleatoriedade)", () => {
    const p = pool();
    const a = selectCandidates("diversified", p, 5, ctx({ rng: createSeededRandom(1) }));
    const b = selectCandidates("diversified", p, 5, ctx({ rng: createSeededRandom(999) }));
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it("prefere o maior score primeiro (candidato 0) e evita concentração de moeda/horário nas escolhas seguintes", () => {
    const p: PoolCandidate[] = [
      { id: "0", symbol: "EUR/USD", timeOfDay: "10:00", direction: "CALL", confidenceScore: 90, poolRank: 0 },
      { id: "1", symbol: "GBP/USD", timeOfDay: "10:05", direction: "CALL", confidenceScore: 89, poolRank: 1 }, // compartilha USD + horário próximo do 0
      { id: "2", symbol: "AUD/CAD", timeOfDay: "14:00", direction: "PUT", confidenceScore: 87, poolRank: 2 }, // sem sobreposição com o 0
    ];
    const selected = selectCandidates("diversified", p, 2, ctx());
    expect(selected[0].id).toBe("0");
    expect(selected[1].id).toBe("2"); // score bruto do 1 > 2, mas a penalização inverte a ordem
  });
});

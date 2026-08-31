import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import {
  DEFAULT_SCORING_CONFIG,
  MAX_WEIGHTS,
  StructuralWindowFrequency,
  classify,
  computeFrequencyScore,
  computePersistenceScore,
  computeSampleScore,
  computeStabilityScore,
  computeMomentum,
  decideRecommendation,
  scoreConfidence,
} from "../multi-period-scoring";

function windows(entries: Array<[number, number, number]>): StructuralWindowFrequency[] {
  return entries.map(([days, frequency, validSamples]) => ({
    days,
    frequency: new Decimal(frequency),
    validSamples,
  }));
}

describe("pesos do Confidence Score", () => {
  it("os pesos máximos somam exatamente 100", () => {
    const total = MAX_WEIGHTS.persistence + MAX_WEIGHTS.frequency + MAX_WEIGHTS.stability + MAX_WEIGHTS.sample + MAX_WEIGHTS.momentum;
    expect(total).toBe(100);
  });
});

describe("computePersistenceScore (seção 5)", () => {
  it("persistência perfeita (3 de 3 janelas confirmadas a 70%) dá 30 pontos cheios", () => {
    const w = windows([
      [70, 82.22, 45],
      [60, 79.59, 49],
      [50, 81.25, 32],
    ]);
    const result = computePersistenceScore(w, new Decimal(70));
    expect(result.confirmed).toBe(3);
    expect(result.total).toBe(3);
    expect(result.percentage.toNumber()).toBe(100);
    expect(result.score.toNumber()).toBe(30);
  });

  it("2 de 3 janelas confirmadas dá 2/3 dos 30 pontos", () => {
    const w = windows([
      [70, 82, 45],
      [60, 65, 49], // abaixo do threshold de 70
      [50, 81, 32],
    ]);
    const result = computePersistenceScore(w, new Decimal(70));
    expect(result.confirmed).toBe(2);
    expect(result.score.toNumber()).toBeCloseTo(20, 5);
  });
});

describe("computeFrequencyScore (seção 6)", () => {
  it("normaliza a média pra 0-30 usando clamp((avg-50)/40, 0, 1)", () => {
    const w = windows([
      [70, 82.22, 45],
      [60, 79.59, 49],
      [50, 81.25, 32],
    ]);
    const result = computeFrequencyScore(w);
    expect(result.average.toDecimalPlaces(2).toNumber()).toBeCloseTo(81.02, 1);
    // normalized = (81.02-50)/40 = 0.7755 -> score = 23.26
    expect(result.score.toDecimalPlaces(2).toNumber()).toBeCloseTo(23.26, 1);
  });

  it("média <= 50% não pontua nada", () => {
    const w = windows([[50, 50, 30]]);
    expect(computeFrequencyScore(w).score.toNumber()).toBe(0);
  });

  it("média >= 90% pontua o máximo (30)", () => {
    const w = windows([[50, 95, 30]]);
    expect(computeFrequencyScore(w).score.toNumber()).toBe(30);
  });
});

describe("computeStabilityScore (seção 7)", () => {
  it("range pequeno (exemplo bom: 82.22/79.59/81.25) pontua no topo", () => {
    const w = windows([
      [70, 82.22, 45],
      [60, 79.59, 49],
      [50, 81.25, 32],
    ]);
    const result = computeStabilityScore(w);
    expect(result.range.toDecimalPlaces(2).toNumber()).toBeCloseTo(2.63, 1);
    expect(result.score.toNumber()).toBe(20); // range <= 3
  });

  it("range grande (exemplo ruim: 95/88/79/71) pontua 0", () => {
    const w = windows([
      [80, 95, 40],
      [70, 88, 40],
      [60, 79, 40],
      [50, 71, 40],
    ]);
    const result = computeStabilityScore(w);
    expect(result.range.toNumber()).toBe(24);
    expect(result.score.toNumber()).toBe(0); // range > 15
  });

  it("bandas intermediárias", () => {
    expect(computeStabilityScore(windows([[70, 80, 30], [50, 75.5, 30]])).score.toNumber()).toBe(17); // range 4.5 -> banda (3,5]
    expect(computeStabilityScore(windows([[70, 80, 30], [50, 73, 30]])).score.toNumber()).toBe(13); // range 7 -> banda (5,8]
  });
});

describe("computeSampleScore (seção 8)", () => {
  it("usa a MENOR amostra entre as janelas (abordagem conservadora)", () => {
    const w = windows([
      [70, 82, 50],
      [60, 79, 22], // menor amostra da lista
      [50, 81, 32],
    ]);
    const result = computeSampleScore(w);
    expect(result.sampleMin).toBe(22);
  });

  it("100% com 4 ocorrências pontua 0 (amostra insuficiente)", () => {
    const w = windows([[50, 100, 4]]);
    expect(computeSampleScore(w).score.toNumber()).toBe(0);
  });

  it("50+ ocorrências pontua o máximo (15)", () => {
    const w = windows([[50, 79, 50]]);
    expect(computeSampleScore(w).score.toNumber()).toBe(15);
  });

  it("interpola dentro das bandas (ex: 40 ocorrências -> entre 11 e 13)", () => {
    const w = windows([[50, 79, 40]]);
    const score = computeSampleScore(w).score.toNumber();
    expect(score).toBeGreaterThanOrEqual(11);
    expect(score).toBeLessThanOrEqual(13);
  });
});

describe("computeMomentum (seções 9-11)", () => {
  it("FORTALECENDO quando 40D sobe consistentemente acima da média estrutural", () => {
    const result = computeMomentum({
      structuralAverage: new Decimal(80),
      momentumFrequency: new Decimal(84),
      momentumOppositeFrequency: new Decimal(16),
      nearestStructuralOppositeFrequency: new Decimal(19),
      declining: false,
    });
    expect(result.trend).toBe("fortalecendo");
    expect(result.inversion).toBe("none");
    expect(result.score.toNumber()).toBe(5);
  });

  it("ENFRAQUECENDO quando 40D cai bem abaixo da média, mas sem virar a direção oposta", () => {
    const result = computeMomentum({
      structuralAverage: new Decimal(78),
      momentumFrequency: new Decimal(65),
      momentumOppositeFrequency: new Decimal(35),
      nearestStructuralOppositeFrequency: new Decimal(33),
      declining: true,
    });
    expect(result.trend).toBe("enfraquecendo");
    expect(result.inversion).toBe("none");
  });

  it("nunca recomenda CONTRA só por queda de frequência — exige a direção OPOSTA predominando (seção 10)", () => {
    // CALL caiu bastante, mas PUT NÃO está de fato dominando 40D (só 45%) — não é inversão.
    const result = computeMomentum({
      structuralAverage: new Decimal(78),
      momentumFrequency: new Decimal(55),
      momentumOppositeFrequency: new Decimal(45),
      nearestStructuralOppositeFrequency: new Decimal(30),
      declining: true,
    });
    expect(result.inversion).toBe("none");
    expect(result.trend).not.toBe("possivel_inversao");
  });

  it("POSSÍVEL INVERSÃO quando a direção oposta domina 40D com deterioração progressiva", () => {
    const result = computeMomentum({
      structuralAverage: new Decimal(75),
      momentumFrequency: new Decimal(39),
      momentumOppositeFrequency: new Decimal(61),
      nearestStructuralOppositeFrequency: new Decimal(44), // abaixo do threshold de confirmação (55)
      declining: true,
    });
    expect(result.trend).toBe("possivel_inversao");
    expect(result.inversion).toBe("possible");
    expect(result.score.toNumber()).toBe(0);
  });

  it("INVERSÃO CONFIRMADA exige também confirmação na janela estrutural mais próxima (seção 11)", () => {
    const result = computeMomentum({
      structuralAverage: new Decimal(75),
      momentumFrequency: new Decimal(35),
      momentumOppositeFrequency: new Decimal(65),
      nearestStructuralOppositeFrequency: new Decimal(56), // >= 55
      declining: true,
    });
    expect(result.inversion).toBe("confirmed");
  });
});

describe("classify + decideRecommendation (seção 12)", () => {
  it("bandas de classificação", () => {
    expect(classify(94)).toBe("excelente");
    expect(classify(85)).toBe("forte");
    expect(classify(74)).toBe("bom");
    expect(classify(65)).toBe("observar");
    expect(classify(40)).toBe("descartar");
  });

  it("amostra insuficiente é um piso duro: sempre DESCARTAR, mesmo sobre inversão confirmada", () => {
    expect(decideRecommendation("descartar", "confirmed", true)).toBe("descartar");
    expect(decideRecommendation("forte", "confirmed", true)).toBe("descartar");
  });

  it("CONTRA com inversão CONFIRMADA, mesmo que a direção original tenha caído pra DESCARTAR (é o motivo da inversão)", () => {
    expect(decideRecommendation("descartar", "confirmed", false)).toBe("contra");
    expect(decideRecommendation("forte", "confirmed", false)).toBe("contra");
    expect(decideRecommendation("forte", "possible", false)).toBe("observar");
    expect(decideRecommendation("forte", "none", false)).toBe("a_favor");
  });

  it("sem inversão, classificação DESCARTAR ainda recomenda DESCARTAR", () => {
    expect(decideRecommendation("descartar", "none", false)).toBe("descartar");
  });

  it("classificação OBSERVAR sempre recomenda OBSERVAR", () => {
    expect(decideRecommendation("observar", "none", false)).toBe("observar");
  });
});

describe("scoreConfidence — exemplos conhecidos (seção 23)", () => {
  it("AUD/CAD 14:00 CALL (50/60/70, alto e estável) recebe score alto", () => {
    const result = scoreConfidence({
      structuralWindows: windows([
        [70, 82.22, 45],
        [60, 79.59, 49],
        [50, 81.25, 32],
      ]),
      persistenceThresholdPct: new Decimal(70),
      momentum: {
        momentumFrequency: new Decimal(82.1),
        momentumOppositeFrequency: new Decimal(17.9),
        nearestStructuralOppositeFrequency: new Decimal(18.75),
        declining: false,
      },
    });
    // amostra da menor janela (32) é só "aceitável" pela própria régua da seção 8,
    // então o score correto aqui é FORTE (>=80), não necessariamente EXCELENTE.
    expect(result.confidenceScore).toBeGreaterThanOrEqual(80);
    expect(["forte", "excelente"]).toContain(result.classification);
    expect(result.recommendation).toBe("a_favor");
  });

  it("GBP/USD 06:55 PUT (78.13/73.47/71.11, caindo nas janelas maiores) não é descartado, mas pontua abaixo do exemplo anterior", () => {
    const strong = scoreConfidence({
      structuralWindows: windows([
        [70, 82.22, 45],
        [60, 79.59, 49],
        [50, 81.25, 32],
      ]),
      persistenceThresholdPct: new Decimal(70),
      momentum: {
        momentumFrequency: new Decimal(82.1),
        momentumOppositeFrequency: new Decimal(17.9),
        nearestStructuralOppositeFrequency: new Decimal(18.75),
        declining: false,
      },
    });
    const weaker = scoreConfidence({
      structuralWindows: windows([
        [70, 71.11, 45],
        [60, 73.47, 49],
        [50, 78.13, 32],
      ]),
      persistenceThresholdPct: new Decimal(70),
      momentum: {
        momentumFrequency: new Decimal(78),
        momentumOppositeFrequency: new Decimal(22),
        nearestStructuralOppositeFrequency: new Decimal(21.87),
        declining: false,
      },
    });
    expect(weaker.classification).not.toBe("descartar");
    expect(weaker.confidenceScore).toBeLessThan(strong.confidenceScore);
  });

  it("100% com só 4 ocorrências NÃO supera 79% com 50 ocorrências (seção 8 — o problema central do briefing)", () => {
    const fewOccurrences = scoreConfidence({
      structuralWindows: windows([
        [70, 100, 4],
        [60, 100, 4],
        [50, 100, 4],
      ]),
      persistenceThresholdPct: new Decimal(70),
      momentum: {
        momentumFrequency: new Decimal(100),
        momentumOppositeFrequency: new Decimal(0),
        nearestStructuralOppositeFrequency: new Decimal(0),
        declining: false,
      },
    });
    const manyOccurrences = scoreConfidence({
      structuralWindows: windows([
        [70, 79, 50],
        [60, 79, 50],
        [50, 79, 50],
      ]),
      persistenceThresholdPct: new Decimal(70),
      momentum: {
        momentumFrequency: new Decimal(79),
        momentumOppositeFrequency: new Decimal(21),
        nearestStructuralOppositeFrequency: new Decimal(21),
        declining: false,
      },
    });
    expect(manyOccurrences.confidenceScore).toBeGreaterThan(fewOccurrences.confidenceScore);
    expect(fewOccurrences.classification).toBe("descartar"); // piso duro de amostra insuficiente
  });

  it("os subtotais, já arredondados a 2 casas (como são persistidos/exibidos), somam exatamente o confidenceScore — não só os valores crus em memória", () => {
    // varre uma faixa de cenários pra pegar casos onde o arredondamento
    // independente de 5 campos poderia derivar da soma arredondada uma vez só
    for (let avg = 50; avg <= 95; avg += 1) {
      for (let range = 0; range <= 20; range += 2) {
        const result = scoreConfidence({
          structuralWindows: windows([
            [70, avg + range / 2, 45],
            [60, avg, 49],
            [50, avg - range / 2, 32],
          ]),
          persistenceThresholdPct: new Decimal(70),
          momentum: {
            momentumFrequency: new Decimal(avg),
            momentumOppositeFrequency: new Decimal(100 - avg),
            nearestStructuralOppositeFrequency: new Decimal(100 - avg),
            declining: false,
          },
        });
        // exatamente o que a API grava: toFixed(2) em cada subtotal
        const persistedSum =
          Number(result.scores.persistence.toFixed(2)) +
          Number(result.scores.frequency.toFixed(2)) +
          Number(result.scores.stability.toFixed(2)) +
          Number(result.scores.sample.toFixed(2)) +
          Number(result.scores.momentum.toFixed(2));
        expect(Math.round(persistedSum)).toBe(result.confidenceScore);
      }
    }
  });

  it("subtotais nunca somam mais que o confidenceScore final e respeitam os pesos máximos", () => {
    const result = scoreConfidence({
      structuralWindows: windows([
        [100, 78, 60],
        [90, 79.1, 55],
        [80, 80, 50],
        [70, 82.22, 45],
        [60, 79.59, 49],
        [50, 81.25, 32],
      ]),
      persistenceThresholdPct: new Decimal(70),
      momentum: {
        momentumFrequency: new Decimal(82.14),
        momentumOppositeFrequency: new Decimal(17.86),
        nearestStructuralOppositeFrequency: new Decimal(18.75),
        declining: false,
      },
    });
    expect(result.scores.persistence.toNumber()).toBeLessThanOrEqual(MAX_WEIGHTS.persistence);
    expect(result.scores.frequency.toNumber()).toBeLessThanOrEqual(MAX_WEIGHTS.frequency);
    expect(result.scores.stability.toNumber()).toBeLessThanOrEqual(MAX_WEIGHTS.stability);
    expect(result.scores.sample.toNumber()).toBeLessThanOrEqual(MAX_WEIGHTS.sample);
    expect(result.scores.momentum.toNumber()).toBeLessThanOrEqual(MAX_WEIGHTS.momentum);
    const sum = result.scores.persistence
      .plus(result.scores.frequency)
      .plus(result.scores.stability)
      .plus(result.scores.sample)
      .plus(result.scores.momentum);
    expect(sum.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(result.confidenceScore);
  });
});

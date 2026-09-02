import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import {
  DEFAULT_SCORING_CONFIG,
  MAX_WEIGHTS,
  STABILITY_SUB_WEIGHTS,
  StructuralWindowFrequency,
  classify,
  computeFrequencyScore,
  computePersistenceScore,
  computeSampleScore,
  computeStabilityScore,
  computeStructuralRegression,
  computeStructuralQualityScore,
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

/** Monta janelas estruturais a partir de uma lista de frequências (maior janela primeiro), com passo de 10 dias, imitando a saída real do motor. */
function windowsFrom(freqs: number[], startDays: number, validSamples = 30): StructuralWindowFrequency[] {
  return freqs.map((f, i) => ({ days: startDays - i * 10, frequency: new Decimal(f), validSamples }));
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

describe("computeStabilityScore (seção 7) — agora via regressão, não mais range/desvio padrão brutos", () => {
  it("range/desvio padrão continuam calculados e retornados (diagnóstico/UI), mas não determinam mais o score sozinhos", () => {
    // Mesmo exemplo de sempre desta suíte: range pequeno (2.63 p.p.), mas o
    // slope (-0.485 p.p./passo) cai dentro da zona neutra (|slope|<=0.5) —
    // então a direção não penaliza (6/6), e quem imprime menos coerência
    // aqui é o RMSE relativamente alto (1.01) por causa do pequeno zigue-
    // zague 70D->60D->50D. Deixa de ser "20 pontos só pelo range pequeno".
    const w = windows([
      [70, 82.22, 45],
      [60, 79.59, 49],
      [50, 81.25, 32],
    ]);
    const result = computeStabilityScore(w);
    expect(result.range.toDecimalPlaces(2).toNumber()).toBeCloseTo(2.63, 1);
    expect(result.standardDeviation.toDecimalPlaces(2).toNumber()).toBeCloseTo(1.09, 1);
    expect(result.score.toNumber()).toBeCloseTo(17.89, 1);
  });

  it("um declínio grande mas MUITO coerente (95/88/79/71, R² perto de 1) não é mais zerado — é tratado como enfraquecimento organizado", () => {
    // Sob o modelo antigo (range bruto), um range de 24 p.p. zerava a
    // estabilidade. Sob o novo modelo, essa queda é muito bem explicada por
    // uma reta (R²=0.998) — a coerência continua alta; só a direção (que
    // aponta claramente pra baixo) é que fica bem penalizada. O resultado
    // fica moderado-baixo, no mesmo espírito do caso sintético de
    // "enfraquecimento organizado" (seção mais abaixo), não mais um zero
    // automático — só uma trajetória ERRÁTICA (RMSE alto) deve zerar.
    const w = windows([
      [80, 95, 40],
      [70, 88, 40],
      [60, 79, 40],
      [50, 71, 40],
    ]);
    const result = computeStabilityScore(w);
    expect(result.range.toNumber()).toBe(24);
    expect(result.score.toNumber()).toBeCloseTo(13.63, 1);
  });

  it("com só 2 janelas, a reta sempre passa exatamente pelos 2 pontos (RMSE=0, coerência máxima) — quem penaliza é só a direção", () => {
    // Ambos os exemplos têm |slope| bem acima do teto de severidade máxima
    // (fullDirectionSlopePctPer10d=1.5), então os dois ficam com direção
    // zerada e coerência no teto — 14/20 pros dois, mesmo com magnitudes de
    // queda diferentes (a diferença deixa de importar depois que a queda já
    // é "severa o bastante" pra zerar a confiança na direção).
    expect(computeStabilityScore(windows([[70, 80, 30], [50, 75.5, 30]])).score.toNumber()).toBeCloseTo(14, 1);
    expect(computeStabilityScore(windows([[70, 80, 30], [50, 73, 30]])).score.toNumber()).toBeCloseTo(14, 1);
  });
});

describe("computeStructuralRegression — regressão linear no eixo normalizado de passos de 10 dias", () => {
  it("retorna null com menos de 2 janelas (sem regressão utilizável) — nunca NaN", () => {
    expect(computeStructuralRegression([])).toBeNull();
    expect(computeStructuralRegression(windows([[50, 81, 32]]))).toBeNull();
  });

  it("série perfeitamente constante: SST=0 e SSE=0, tratada como trajetória perfeitamente estável (R²=1, sem dividir por zero)", () => {
    const result = computeStructuralRegression(windows([[70, 80, 30], [60, 80, 30], [50, 80, 30]]))!;
    expect(result.slope.toNumber()).toBe(0);
    expect(result.rmse.toNumber()).toBe(0);
    expect(result.rSquared.toNumber()).toBe(1);
    expect(Number.isFinite(result.slope.toNumber())).toBe(true);
    expect(Number.isFinite(result.rSquared.toNumber())).toBe(true);
  });

  it("eixo x normalizado em passos de 10 dias, sempre começando em 0 na maior janela", () => {
    // 70D,60D,50D -> x=0,1,2 ; slope exatamente 1 p.p. por passo (79->80->81).
    const result = computeStructuralRegression(windows([[70, 79, 30], [60, 80, 30], [50, 81, 30]]))!;
    expect(result.slope.toNumber()).toBeCloseTo(1, 6);
    expect(result.intercept.toNumber()).toBeCloseTo(79, 6);
    expect(result.rSquared.toNumber()).toBeCloseTo(1, 6);
    expect(result.rmse.toNumber()).toBeCloseTo(0, 6);
  });
});

describe("computeStructuralQualityScore — coerência (14) + direção (6) = estabilidade (20)", () => {
  it("os pesos internos da estabilidade somam exatamente 20", () => {
    expect(STABILITY_SUB_WEIGHTS.coherence + STABILITY_SUB_WEIGHTS.direction).toBe(MAX_WEIGHTS.stability);
  });

  it("sem janelas suficientes pra regressão (1 janela), não penaliza por falta de evidência — 20/20", () => {
    const result = computeStructuralQualityScore(windows([[50, 81, 32]]));
    expect(result.regression).toBeNull();
    expect(result.stabilityScore.toNumber()).toBe(20);
  });

  describe("casos reais (seção 23 do briefing)", () => {
    it("CASO 1 — EUR/GBP 09:25 PUT (79.59, 80.95, 80.00): trajetória muito estável, ~19-20", () => {
      const score = computeStructuralQualityScore(windowsFrom([79.59, 80.95, 80.0], 70)).stabilityScore.toNumber();
      expect(score).toBeGreaterThanOrEqual(19);
      expect(score).toBeLessThanOrEqual(20);
    });

    it("CASO 2 — AUD/CHF 13:55 CALL (78.72, 80.00, 81.82): fortalecimento extremamente organizado (R² perto de 1), ~19-20", () => {
      const result = computeStructuralQualityScore(windowsFrom([78.72, 80.0, 81.82], 70));
      expect(result.regression!.rSquared.toNumber()).toBeGreaterThan(0.95);
      expect(result.stabilityScore.toNumber()).toBeGreaterThanOrEqual(19);
      expect(result.stabilityScore.toNumber()).toBeLessThanOrEqual(20);
    });

    it("CASO 3 — AUD/JPY/GBPUSD (70.21, 70.73, 70.59): estrutura praticamente horizontal, ~19-20", () => {
      const score = computeStructuralQualityScore(windowsFrom([70.21, 70.73, 70.59], 70)).stabilityScore.toNumber();
      expect(score).toBeGreaterThanOrEqual(19);
      expect(score).toBeLessThanOrEqual(20);
    });

    it("CASO 4 — AUD/CAD 14:00 CALL (76.60, 78.05, 76.47): pequena oscilação em torno de um nível consistente, ~18-20", () => {
      const score = computeStructuralQualityScore(windowsFrom([76.6, 78.05, 76.47], 70)).stabilityScore.toNumber();
      expect(score).toBeGreaterThanOrEqual(18);
      expect(score).toBeLessThanOrEqual(20);
    });

    it("CASO 5 — EUR/USD 06:55 PUT (77.78, 82.76, 87.50): fortalecimento quase perfeitamente linear — NÃO penalizar apesar do range alto (9.72 p.p.) e desvio padrão alto (3.97 p.p.)", () => {
      const w = windowsFrom([77.78, 82.76, 87.5], 70);
      const stab = computeStabilityScore(w);
      expect(stab.range.toDecimalPlaces(2).toNumber()).toBeCloseTo(9.72, 1);
      expect(stab.standardDeviation.toDecimalPlaces(2).toNumber()).toBeCloseTo(3.97, 1);
      const quality = computeStructuralQualityScore(w);
      expect(quality.regression!.rSquared.toNumber()).toBeGreaterThan(0.95);
      expect(quality.regression!.rmse.toNumber()).toBeLessThan(1);
      expect(quality.stabilityScore.toNumber()).toBeGreaterThanOrEqual(19);
      expect(quality.stabilityScore.toNumber()).toBeLessThanOrEqual(20);
    });

    it("CASO 6 — EUR/GBP 12:25 PUT (76.00, 79.07, 75.00): oscila mais que os anteriores, ~14-16", () => {
      const score = computeStructuralQualityScore(windowsFrom([76.0, 79.07, 75.0], 70)).stabilityScore.toNumber();
      expect(score).toBeGreaterThanOrEqual(14);
      expect(score).toBeLessThanOrEqual(16);
    });

    it("CASO 7 — EUR/CHF 13:55 CALL (71.43, 73.81, 71.43): estável, mas com oscilação central perceptível, ~16-19", () => {
      const score = computeStructuralQualityScore(windowsFrom([71.43, 73.81, 71.43], 70)).stabilityScore.toNumber();
      expect(score).toBeGreaterThanOrEqual(16);
      expect(score).toBeLessThanOrEqual(19);
    });

    it("CASO 8 — AUD/JPY 11:50 PUT (66.00, 72.09, 72.22): fortalecimento menos linear que o EUR/USD, ~14-17", () => {
      const score = computeStructuralQualityScore(windowsFrom([66.0, 72.09, 72.22], 70)).stabilityScore.toNumber();
      expect(score).toBeGreaterThanOrEqual(14);
      expect(score).toBeLessThanOrEqual(17);
    });
  });

  describe("cenários sintéticos obrigatórios", () => {
    it("fortalecimento organizado (74,76,79,82,85,88): scoreStability >= 19", () => {
      const score = computeStructuralQualityScore(windowsFrom([74, 76, 79, 82, 85, 88], 100)).stabilityScore.toNumber();
      expect(score).toBeGreaterThanOrEqual(19);
    });

    it("estável (79,79.5,79,80,79.5,80): scoreStability >= 19", () => {
      const score = computeStructuralQualityScore(windowsFrom([79, 79.5, 79, 80, 79.5, 80], 100)).stabilityScore.toNumber();
      expect(score).toBeGreaterThanOrEqual(19);
    });

    it("errático (74,88,73,86,75,87): RMSE alto, scoreStability <= 7 — não confundir com fortalecimento só por ter slope positivo", () => {
      const w = windowsFrom([74, 88, 73, 86, 75, 87], 100);
      const result = computeStructuralQualityScore(w);
      // o slope até dá levemente positivo (ruído), mas o RMSE alto zera a
      // coerência — é isso que impede o falso-positivo de "fortalecimento".
      expect(result.regression!.rmse.toNumber()).toBeGreaterThan(4);
      expect(result.stabilityScore.toNumber()).toBeLessThanOrEqual(7);
    });

    it("enfraquecimento organizado (88,85,82,79,76,74): RMSE baixo, R² alto, coerência alta, MAS direção próxima de 0 — scoreStability ~12-15 (não é 'errático')", () => {
      const w = windowsFrom([88, 85, 82, 79, 76, 74], 100);
      const result = computeStructuralQualityScore(w);
      expect(result.regression!.rmse.toNumber()).toBeLessThan(1);
      expect(result.regression!.rSquared.toNumber()).toBeGreaterThan(0.95);
      expect(result.coherenceScore.toNumber()).toBeGreaterThan(10);
      expect(result.directionScore.toNumber()).toBeLessThan(1);
      expect(result.stabilityScore.toNumber()).toBeGreaterThanOrEqual(12);
      expect(result.stabilityScore.toNumber()).toBeLessThanOrEqual(15);
    });
  });

  it("CONSISTÊNCIA 70D vs 100D: mesmo slope (~-1 p.p./passo) deve ser interpretado com severidade semelhante, não penalizado a mais só por variação total maior", () => {
    const result70d = computeStructuralQualityScore(windowsFrom([80, 79, 78], 70));
    const result100d = computeStructuralQualityScore(windowsFrom([83, 82, 81, 80, 79, 78], 100));

    expect(result70d.regression!.slope.toNumber()).toBeCloseTo(-1, 6);
    expect(result100d.regression!.slope.toNumber()).toBeCloseTo(-1, 6);

    // mesmo slope + mesmo R² (ambos perfeitamente lineares aqui) -> mesmíssimo
    // directionScore e coherenceScore, independente de serem 3 ou 6 pontos.
    expect(result70d.directionScore.toNumber()).toBeCloseTo(result100d.directionScore.toNumber(), 6);
    expect(result70d.coherenceScore.toNumber()).toBeCloseTo(result100d.coherenceScore.toNumber(), 6);
    expect(result70d.stabilityScore.toNumber()).toBeCloseTo(result100d.stabilityScore.toNumber(), 6);
  });

  it("valores de referência do briefing pro directionScore (slope -0.5/-1.0/-1.5 com R²=1)", () => {
    // -0.5 cai na zona neutra (|slope|<=0.5) -> 6 cheio.
    expect(computeStructuralQualityScore(windowsFrom([80.5, 80, 79.5], 70)).directionScore.toNumber()).toBeCloseTo(6, 1);
    // -1.0, R²=1 -> severity=0.5, penalty=0.5 -> 6*(1-0.5)=3.
    expect(computeStructuralQualityScore(windowsFrom([80, 79, 78], 70)).directionScore.toNumber()).toBeCloseTo(3, 1);
    // -1.5, R²=1 -> severity=1, penalty=1 -> 0.
    expect(computeStructuralQualityScore(windowsFrom([81, 79.5, 78], 70)).directionScore.toNumber()).toBeCloseTo(0, 1);
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

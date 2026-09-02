/**
 * Confidence Score da Análise Plus (Multi-Period Analysis).
 *
 * Módulo PURO: só matemática, sem banco nem candles. Recebe as frequências
 * já calculadas por janela (isso é responsabilidade de
 * `multi-period-analyzer.ts`) e devolve o score 0-100 + classificação +
 * recomendação.
 *
 * Pesos (somam exatamente 100 no máximo — nunca deixar os subtotais
 * ultrapassarem isso, `scoreConfidence` garante por construção):
 *
 *   PERSISTÊNCIA        = 30 pontos
 *   FREQUÊNCIA MÉDIA     = 30 pontos
 *   ESTABILIDADE        = 20 pontos
 *   TAMANHO DA AMOSTRA   = 15 pontos
 *   MOMENTUM RECENTE     = 5 pontos
 *
 * Todos os thresholds usados nas fórmulas ficam centralizados em
 * `DEFAULT_SCORING_CONFIG` — é o único lugar a mexer para recalibrar.
 *
 * IMPORTANTE (regra de produto): o Confidence Score NÃO é uma probabilidade
 * de vitória da próxima entrada. É só um indicador interno da robustez
 * histórica do padrão na amostra analisada. Frequências devem sempre ser
 * apresentadas como "frequência histórica na amostra", nunca como "chance de
 * ganhar".
 */
import { Decimal } from "decimal.js";
import { Direction } from "./candle-classifier";

export type Classification = "excelente" | "forte" | "bom" | "observar" | "descartar";
export type Recommendation = "a_favor" | "contra" | "observar" | "descartar";
export type MomentumTrend = "fortalecendo" | "estavel" | "enfraquecendo" | "possivel_inversao";
export type InversionState = "none" | "possible" | "confirmed";

export interface StructuralQualityConfig {
  /**
   * Escala do RMSE (p.p.) no decaimento exponencial da coerência — seção C
   * (COERÊNCIA DA TRAJETÓRIA). rmse=0 -> score máximo; rmse=rmseScalePct ->
   * score cai pra ~37% do máximo (1/e); rmse alto -> score próximo de 0.
   */
  rmseScalePct: Decimal;
  /** |slope| (p.p. por passo de 10 dias) até este valor é tratado como trajetória horizontal — nem fortalecendo nem enfraquecendo, não penaliza. */
  neutralSlopePctPer10d: Decimal;
  /** |slope| a partir deste valor já representa a severidade MÁXIMA de enfraquecimento (severity=1). */
  fullDirectionSlopePctPer10d: Decimal;
}

export interface SampleAnchor {
  /** Amostra mínima (menor validSamples entre as janelas estruturais). */
  sample: number;
  score: number;
}

export interface ScoringConfig {
  /** Menor janela estrutural — janelas abaixo disso não existem (40D é só momentum). */
  minStructuralDays: number;
  /** Janela fixa de momentum (não entra em persistência/frequência/estabilidade/amostra). */
  momentumWindowDays: number;

  /** % mínimo, na direção escolhida, pra uma janela estrutural contar como "confirmada" (seção 5). Configurável por análise. */
  defaultPersistenceThresholdPct: Decimal;

  /** frequencyNormalized = clamp((avg - floor) / range, 0, 1) — seção 6. */
  frequencyNormalizationFloorPct: Decimal;
  frequencyNormalizationRangePct: Decimal;

  /**
   * ESTABILIDADE (20 pontos no total, seção 7) responde "as frequências das
   * janelas estruturais formam uma trajetória coerente?" — via regressão
   * linear sobre as janelas (`computeStructuralRegression`), dividida em:
   *   A) coerência da trajetória (RMSE dos resíduos) -> até 14 pontos
   *   B) direção estrutural (slope por passo de 10 dias + R²) -> até 6 pontos
   * Range e desvio padrão continuam calculados e retornados pra exibição/
   * diagnóstico, mas não determinam mais o score diretamente.
   */
  structuralQuality: StructuralQualityConfig;

  /** Pontos-âncora pra interpolação linear do score de amostra (seção 8). */
  sampleAnchors: SampleAnchor[];
  /** Amostra mínima abaixo da qual o padrão é DESCARTADO independente do score (mesmo espírito do PatternStatus.INSUFFICIENT_SAMPLE do motor de período único). */
  minAcceptableSample: number;

  momentum: {
    /** delta = frequência(40D) - médiaEstrutural. >= isso => FORTALECENDO. */
    strengthenDeltaPct: Decimal;
    /** delta <= isso => ENFRAQUECENDO. */
    weakenDeltaPct: Decimal;
    scoreStrengthen: Decimal;
    scoreStable: Decimal;
    scoreWeaken: Decimal;
    scoreInversion: Decimal;
  };

  inversion: {
    /** % mínimo da direção OPOSTA em 40D pra levantar "possível inversão" (seção 11). */
    possibleOpposite40dPct: Decimal;
    /** % mínimo da direção OPOSTA em 40D pra "inversão confirmada" (mais estrito que o de cima). */
    confirmedOpposite40dPct: Decimal;
    /** % mínimo da direção OPOSTA na janela estrutural mais recente, também exigido pra confirmar. */
    confirmedOppositeNearestStructuralPct: Decimal;
  };

  /** Bandas de classificação por score final (seção 12), da mais alta pra mais baixa. */
  classificationBands: Array<{ min: number; label: Classification }>;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  minStructuralDays: 50,
  momentumWindowDays: 40,

  defaultPersistenceThresholdPct: new Decimal(70),

  frequencyNormalizationFloorPct: new Decimal(50),
  frequencyNormalizationRangePct: new Decimal(40),

  structuralQuality: {
    rmseScalePct: new Decimal("2.5"),
    neutralSlopePctPer10d: new Decimal("0.5"),
    fullDirectionSlopePctPer10d: new Decimal("1.5"),
  },

  sampleAnchors: [
    { sample: 0, score: 0 },
    { sample: 20, score: 0 },
    { sample: 29, score: 5 },
    { sample: 34, score: 8 },
    { sample: 39, score: 11 },
    { sample: 49, score: 13 },
    { sample: 50, score: 15 },
  ],
  minAcceptableSample: 20,

  momentum: {
    strengthenDeltaPct: new Decimal(3),
    weakenDeltaPct: new Decimal(-10),
    scoreStrengthen: new Decimal(5),
    scoreStable: new Decimal(3),
    scoreWeaken: new Decimal(1),
    scoreInversion: new Decimal(0),
  },

  inversion: {
    possibleOpposite40dPct: new Decimal(60),
    confirmedOpposite40dPct: new Decimal(65),
    confirmedOppositeNearestStructuralPct: new Decimal(55),
  },

  classificationBands: [
    { min: 90, label: "excelente" },
    { min: 80, label: "forte" },
    { min: 70, label: "bom" },
    { min: 60, label: "observar" },
    { min: 0, label: "descartar" },
  ],
};

/** Peso máximo de cada critério — a soma DEVE ser 100. Verificado em teste. */
export const MAX_WEIGHTS = {
  persistence: 30,
  frequency: 30,
  stability: 20,
  sample: 15,
  momentum: 5,
} as const;

/** Divisão interna dos 20 pontos de ESTABILIDADE (`MAX_WEIGHTS.stability`) — soma DEVE ser 20. Verificado em teste. */
export const STABILITY_SUB_WEIGHTS = {
  coherence: 14,
  direction: 6,
} as const;

export interface StructuralWindowFrequency {
  days: number;
  /** % de ocorrências, dentro da janela, na direção escolhida do padrão. */
  frequency: Decimal;
  validSamples: number;
}

function clampDecimal(value: Decimal, min: Decimal, max: Decimal): Decimal {
  if (value.lt(min)) return min;
  if (value.gt(max)) return max;
  return value;
}

/** Seção 5 — PERSISTÊNCIA (30 pontos). Só considera janelas estruturais (>=50D). */
export function computePersistenceScore(
  windows: StructuralWindowFrequency[],
  thresholdPct: Decimal,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): { confirmed: number; total: number; percentage: Decimal; score: Decimal } {
  const total = windows.length;
  const confirmed = windows.filter((w) => w.frequency.gte(thresholdPct)).length;
  const percentage = total > 0 ? new Decimal(confirmed).div(total).mul(100) : new Decimal(0);
  const score = total > 0 ? new Decimal(confirmed).div(total).mul(MAX_WEIGHTS.persistence) : new Decimal(0);
  return { confirmed, total, percentage, score };
}

/** Seção 6 — FREQUÊNCIA MÉDIA (30 pontos). Só considera janelas estruturais (>=50D). */
export function computeFrequencyScore(
  windows: StructuralWindowFrequency[],
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): { average: Decimal; score: Decimal } {
  if (windows.length === 0) return { average: new Decimal(0), score: new Decimal(0) };
  const sum = windows.reduce((acc, w) => acc.plus(w.frequency), new Decimal(0));
  const average = sum.div(windows.length);
  const normalized = clampDecimal(
    average.minus(config.frequencyNormalizationFloorPct).div(config.frequencyNormalizationRangePct),
    new Decimal(0),
    new Decimal(1)
  );
  return { average, score: normalized.mul(MAX_WEIGHTS.frequency) };
}

function standardDeviation(values: Decimal[]): Decimal {
  if (values.length === 0) return new Decimal(0);
  const mean = values.reduce((acc, v) => acc.plus(v), new Decimal(0)).div(values.length);
  const variance = values.reduce((acc, v) => acc.plus(v.minus(mean).pow(2)), new Decimal(0)).div(values.length);
  return variance.sqrt();
}

export interface StructuralRegressionResult {
  /** Pontos percentuais de frequência por passo de 10 dias EM DIREÇÃO AO PRESENTE (x cresce conforme a janela encolhe). */
  slope: Decimal;
  intercept: Decimal;
  rmse: Decimal;
  rSquared: Decimal;
}

/**
 * Regressão linear simples sobre as janelas estruturais, no eixo x
 * NORMALIZADO em passos de 10 dias — não em dias brutos — pra que o mesmo
 * slope signifique a mesma coisa numa análise de 70D (3 pontos) ou de 100D
 * (6 pontos). `windows` chega ordenado da MAIOR janela pra MENOR (seção
 * "ORDEM DAS JANELAS"), e a maior janela sempre vira x=0:
 *
 *   x = (maxStructuralDays - window.days) / 10
 *
 * x cresce conforme a janela encolhe, ou seja, caminhando EM DIREÇÃO AO
 * PRESENTE — um slope positivo significa fortalecimento recente.
 *
 * Retorna `null` quando há menos de 2 janelas (sem regressão utilizável) —
 * ver `computeStructuralQualityScore` pra como esse caso é tratado no score.
 */
export function computeStructuralRegression(windows: StructuralWindowFrequency[]): StructuralRegressionResult | null {
  if (windows.length < 2) return null;

  const maxStructuralDays = windows[0].days;
  const points = windows.map((w) => ({
    x: new Decimal(maxStructuralDays - w.days).div(10),
    y: w.frequency,
  }));
  const n = points.length;

  const meanX = points.reduce((acc, p) => acc.plus(p.x), new Decimal(0)).div(n);
  const meanY = points.reduce((acc, p) => acc.plus(p.y), new Decimal(0)).div(n);

  const sxy = points.reduce((acc, p) => acc.plus(p.x.minus(meanX).mul(p.y.minus(meanY))), new Decimal(0));
  const sxx = points.reduce((acc, p) => acc.plus(p.x.minus(meanX).pow(2)), new Decimal(0));

  // sxx só seria 0 se todo x fosse igual, o que exigiria windows.length < 2
  // (janelas estruturais nunca repetem `days`) — já tratado acima. Mantido
  // como salvaguarda pra nunca dividir por zero.
  const slope = sxx.isZero() ? new Decimal(0) : sxy.div(sxx);
  const intercept = meanY.minus(slope.mul(meanX));

  const sse = points.reduce((acc, p) => {
    const residual = p.y.minus(intercept.plus(slope.mul(p.x)));
    return acc.plus(residual.pow(2));
  }, new Decimal(0));
  const rmse = sse.div(n).sqrt();

  const sst = points.reduce((acc, p) => acc.plus(p.y.minus(meanY).pow(2)), new Decimal(0));
  // série constante (SST=0) => trajetória perfeitamente estável, e a reta de
  // mínimos quadrados nesse caso é sempre y=meanY (SSE também é 0) — nunca
  // produz NaN/Infinity: tratado como R²=1 diretamente, sem dividir por zero.
  const rSquared = sst.isZero() ? new Decimal(1) : clampDecimal(new Decimal(1).minus(sse.div(sst)), new Decimal(0), new Decimal(1));

  return { slope, intercept, rmse, rSquared };
}

export interface StructuralQualityResult {
  regression: StructuralRegressionResult | null;
  /** Seção C.1 — até `STABILITY_SUB_WEIGHTS.coherence` (14) pontos. */
  coherenceScore: Decimal;
  /** Seção C.2 — até `STABILITY_SUB_WEIGHTS.direction` (6) pontos. */
  directionScore: Decimal;
  /** coherenceScore + directionScore, já limitado a [0, MAX_WEIGHTS.stability]. */
  stabilityScore: Decimal;
}

/**
 * Seção 7 — ESTABILIDADE (20 pontos): "as frequências das janelas
 * estruturais formam uma trajetória coerente?" Uma trajetória pode ser boa
 * de duas formas — estável (horizontal) OU fortalecendo de forma organizada
 * — e ruim de duas formas — errática OU enfraquecendo. Range alto NÃO
 * significa instabilidade (um fortalecimento organizado tem range alto e
 * ainda assim é uma ótima trajetória), por isso o score não usa mais
 * range/desvio padrão brutos como critério principal — usa a regressão
 * linear (`computeStructuralRegression`).
 */
export function computeStructuralQualityScore(
  windows: StructuralWindowFrequency[],
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): StructuralQualityResult {
  const regression = computeStructuralRegression(windows);
  const { coherence: maxCoherence, direction: maxDirection } = STABILITY_SUB_WEIGHTS;

  if (!regression) {
    // Menos de 2 janelas estruturais: não existe regressão utilizável, ou
    // seja, não há nenhuma evidência de trajetória incoerente NEM de direção
    // (favorável ou desfavorável) — decisão: não penalizar por falta de
    // evidência (mesmo espírito de outros pontos do motor, ex: persistência
    // com poucas janelas), dando os 20 pontos cheios.
    const coherenceScore = new Decimal(maxCoherence);
    const directionScore = new Decimal(maxDirection);
    return { regression: null, coherenceScore, directionScore, stabilityScore: coherenceScore.plus(directionScore) };
  }

  const { rmseScalePct, neutralSlopePctPer10d, fullDirectionSlopePctPer10d } = config.structuralQuality;

  // A) COERÊNCIA DA TRAJETÓRIA — RMSE baixo (pontos acompanham bem uma reta,
  // seja ela horizontal, subindo ou descendo) pontua alto; RMSE alto
  // (errático, sem trajetória coerente) pontua baixo. Decaimento exponencial:
  // coherenceScore = 14 * exp(-((rmse / rmseScalePct) ^ 2)).
  const rmseRatio = regression.rmse.div(rmseScalePct);
  const coherenceScore = clampDecimal(
    rmseRatio.pow(2).neg().exp().mul(maxCoherence),
    new Decimal(0),
    new Decimal(maxCoherence)
  );

  // B) DIREÇÃO ESTRUTURAL — usa o SLOPE por passo de 10 dias (não a variação
  // bruta total entre primeira e última janela), pra funcionar igual em
  // janelas de 70D e de 100D.
  const absSlope = regression.slope.abs();
  let directionScore: Decimal;
  if (absSlope.lte(neutralSlopePctPer10d)) {
    // trajetória praticamente horizontal (zona neutra) — não penaliza.
    directionScore = new Decimal(maxDirection);
  } else if (regression.slope.gt(0)) {
    // fortalecimento: a organização da trajetória já foi avaliada pela
    // coerência acima — aqui só reduz um pouco a confiança quando R² é
    // baixo, sem duplicar a penalização já aplicada pelo RMSE.
    const positiveDirectionConfidence = new Decimal("0.75").plus(regression.rSquared.mul("0.25"));
    directionScore = positiveDirectionConfidence.mul(maxDirection);
  } else {
    // enfraquecimento: penaliza gradualmente conforme a severidade da queda
    // (slope) E a confiança de que essa queda é estruturalmente real (R²) —
    // uma queda com R² baixo não tem evidência estrutural forte, e a
    // coerência (RMSE) já deve penalizar esse caso separadamente.
    const severity = clampDecimal(
      absSlope.minus(neutralSlopePctPer10d).div(fullDirectionSlopePctPer10d.minus(neutralSlopePctPer10d)),
      new Decimal(0),
      new Decimal(1)
    );
    const directionPenalty = severity.mul(regression.rSquared);
    directionScore = new Decimal(maxDirection).mul(new Decimal(1).minus(directionPenalty));
  }
  directionScore = clampDecimal(directionScore, new Decimal(0), new Decimal(maxDirection));

  const stabilityScore = clampDecimal(
    coherenceScore.plus(directionScore),
    new Decimal(0),
    new Decimal(MAX_WEIGHTS.stability)
  );

  return { regression, coherenceScore, directionScore, stabilityScore };
}

/**
 * Seção 7 — ESTABILIDADE (20 pontos). O subtotal público continua sendo só
 * `{range, standardDeviation, score}` (não quebra os consumidores atuais) —
 * range/desvio padrão continuam calculados pra exibição/diagnóstico, mas
 * quem determina `score` agora é `computeStructuralQualityScore`.
 */
export function computeStabilityScore(
  windows: StructuralWindowFrequency[],
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): { range: Decimal; standardDeviation: Decimal; score: Decimal } {
  if (windows.length === 0) {
    return { range: new Decimal(0), standardDeviation: new Decimal(0), score: new Decimal(0) };
  }
  const frequencies = windows.map((w) => w.frequency);
  const max = frequencies.reduce((a, b) => (b.gt(a) ? b : a));
  const min = frequencies.reduce((a, b) => (b.lt(a) ? b : a));
  const range = max.minus(min);
  const stdDev = standardDeviation(frequencies);

  const quality = computeStructuralQualityScore(windows, config);
  return { range, standardDeviation: stdDev, score: quality.stabilityScore };
}

/** Interpolação linear entre pontos-âncora (usado pelo score de amostra — seção 8). */
function interpolate(x: number, anchors: SampleAnchor[]): number {
  if (x <= anchors[0].sample) return anchors[0].score;
  const last = anchors[anchors.length - 1];
  if (x >= last.sample) return last.score;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (x >= a.sample && x <= b.sample) {
      const ratio = (x - a.sample) / (b.sample - a.sample);
      return a.score + ratio * (b.score - a.score);
    }
  }
  return last.score;
}

/**
 * Seção 8 — TAMANHO DA AMOSTRA (15 pontos). Usa a MENOR quantidade de
 * ocorrências válidas entre as janelas estruturais (abordagem conservadora:
 * não deixa uma janela grande "inflar" o score se outra janela tiver poucos
 * dados) — não usa apenas a maior janela.
 */
export function computeSampleScore(
  windows: StructuralWindowFrequency[],
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): { sampleMin: number; score: Decimal } {
  if (windows.length === 0) return { sampleMin: 0, score: new Decimal(0) };
  const sampleMin = Math.min(...windows.map((w) => w.validSamples));
  const score = new Decimal(interpolate(sampleMin, config.sampleAnchors)).toDecimalPlaces(2);
  return { sampleMin, score };
}

export interface MomentumInput {
  /** Média estrutural (mesma usada na frequência — exclui a janela de momentum). */
  structuralAverage: Decimal;
  /** % da direção escolhida do padrão, na janela de momentum (40D). */
  momentumFrequency: Decimal;
  /** % da direção OPOSTA, na janela de momentum (40D). */
  momentumOppositeFrequency: Decimal;
  /** % da direção OPOSTA, na janela estrutural mais recente (a menor, ex: 50D). */
  nearestStructuralOppositeFrequency: Decimal;
  /**
   * Deterioração progressiva: frequência da direção escolhida na janela
   * estrutural mais recente é menor que na janela estrutural mais antiga
   * (maior). Calculado pelo chamador a partir da lista completa de janelas.
   */
  declining: boolean;
}

/** Seções 9, 10 e 11 — MOMENTUM (5 pontos) + detecção de inversão. */
export function computeMomentum(
  input: MomentumInput,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): { trend: MomentumTrend; inversion: InversionState; score: Decimal } {
  const { inversion: inv } = config;

  // Seção 10: NUNCA inferir "contra" só porque a direção escolhida caiu —
  // exige evidência estatística explícita da direção OPOSTA predominando.
  const possible =
    input.declining && input.momentumOppositeFrequency.gte(inv.possibleOpposite40dPct);
  const confirmed =
    possible &&
    input.momentumOppositeFrequency.gte(inv.confirmedOpposite40dPct) &&
    input.nearestStructuralOppositeFrequency.gte(inv.confirmedOppositeNearestStructuralPct);

  if (possible) {
    return {
      trend: "possivel_inversao",
      inversion: confirmed ? "confirmed" : "possible",
      score: config.momentum.scoreInversion,
    };
  }

  const delta = input.momentumFrequency.minus(input.structuralAverage);
  if (delta.gte(config.momentum.strengthenDeltaPct)) {
    return { trend: "fortalecendo", inversion: "none", score: config.momentum.scoreStrengthen };
  }
  if (delta.lte(config.momentum.weakenDeltaPct)) {
    return { trend: "enfraquecendo", inversion: "none", score: config.momentum.scoreWeaken };
  }
  return { trend: "estavel", inversion: "none", score: config.momentum.scoreStable };
}

export function classify(score: number, config: ScoringConfig = DEFAULT_SCORING_CONFIG): Classification {
  for (const band of config.classificationBands) {
    if (score >= band.min) return band.label;
  }
  return "descartar";
}

/**
 * Seções 10 e 12 — a recomendação NUNCA vira "contra" sozinha por causa de
 * frequência baixa: só quando `inversion === "confirmed"` (evidência
 * estatística explícita da direção oposta).
 *
 * IMPORTANTE sobre a ordem: quando a direção oposta está de fato confirmada
 * (`inversion === "confirmed"`), o score/classificação da direção ORIGINAL
 * costuma estar naturalmente ruim (é exatamente o padrão perdendo força pra
 * virar) — isso não deve suprimir a recomendação CONTRA, é o próprio motivo
 * dela existir. Quem realmente deve travar tudo em DESCARTAR, mesmo sobre
 * uma inversão confirmada, é amostra insuficiente (`insufficientSample`):
 * com poucos dados nem a inversão é confiável.
 */
export function decideRecommendation(
  classification: Classification,
  inversion: InversionState,
  insufficientSample: boolean
): Recommendation {
  if (insufficientSample) return "descartar";
  if (inversion === "confirmed") return "contra";
  if (classification === "descartar") return "descartar";
  if (inversion === "possible") return "observar";
  if (classification === "observar") return "observar";
  return "a_favor";
}

export interface ConfidenceScoreResult {
  confidenceScore: number;
  classification: Classification;
  recommendation: Recommendation;
  scores: {
    persistence: Decimal;
    frequency: Decimal;
    stability: Decimal;
    sample: Decimal;
    momentum: Decimal;
  };
  persistence: { confirmed: number; total: number; percentage: Decimal };
  structuralAverage: Decimal;
  stability: { range: Decimal; standardDeviation: Decimal };
  sampleMin: number;
  momentumTrend: MomentumTrend;
  inversion: InversionState;
}

/**
 * Orquestra as 5 fórmulas e monta o Confidence Score final (0-100). Garante,
 * por construção, que os subtotais nunca somam mais que 100 — cada
 * `computeXScore` já é limitado ao próprio peso máximo.
 */
export function scoreConfidence(params: {
  structuralWindows: StructuralWindowFrequency[];
  persistenceThresholdPct: Decimal;
  /** `structuralAverage` é derivado aqui mesmo (seção "frequência média") — o chamador não precisa calculá-lo. */
  momentum: Omit<MomentumInput, "structuralAverage">;
  config?: ScoringConfig;
}): ConfidenceScoreResult {
  const config = params.config ?? DEFAULT_SCORING_CONFIG;

  const persistence = computePersistenceScore(params.structuralWindows, params.persistenceThresholdPct, config);
  const frequency = computeFrequencyScore(params.structuralWindows, config);
  const stability = computeStabilityScore(params.structuralWindows, config);
  const sample = computeSampleScore(params.structuralWindows, config);
  const momentum = computeMomentum({ ...params.momentum, structuralAverage: frequency.average }, config);

  // Arredonda cada subtotal para 2 casas ANTES de somar — é exatamente o que
  // fica exposto/gravado (seção 20: "os subtotais obrigatoriamente devem
  // somar" o score final). Somar os valores JÁ arredondados garante que
  // confidenceScore bate com a soma do que a tela mostra; somar os valores
  // "crus" e só arredondar o total no final podia deixar a soma exibida uns
  // décimos diferente do score exibido.
  const scores = {
    persistence: persistence.score.toDecimalPlaces(2),
    frequency: frequency.score.toDecimalPlaces(2),
    stability: stability.score.toDecimalPlaces(2),
    sample: sample.score.toDecimalPlaces(2),
    momentum: momentum.score.toDecimalPlaces(2),
  };

  const rawTotal = scores.persistence.plus(scores.frequency).plus(scores.stability).plus(scores.sample).plus(scores.momentum);

  // amostra insuficiente é um piso duro (mesmo espírito de
  // PatternStatus.INSUFFICIENT_SAMPLE no motor de período único): nenhuma
  // combinação de persistência/frequência/estabilidade turbina um padrão
  // com poucas ocorrências até um score enganosamente alto.
  const insufficientSample = sample.sampleMin < config.minAcceptableSample;
  const confidenceScore = insufficientSample
    ? Math.min(59, rawTotal.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber())
    : rawTotal.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

  const classification = classify(confidenceScore, config);
  const recommendation = decideRecommendation(classification, momentum.inversion, insufficientSample);

  return {
    confidenceScore,
    classification,
    recommendation,
    scores,
    persistence: { confirmed: persistence.confirmed, total: persistence.total, percentage: persistence.percentage },
    structuralAverage: frequency.average,
    stability: { range: stability.range, standardDeviation: stability.standardDeviation },
    sampleMin: sample.sampleMin,
    momentumTrend: momentum.trend,
    inversion: momentum.inversion,
  };
}

export function oppositeDirection(direction: Direction.CALL | Direction.PUT): Direction.CALL | Direction.PUT {
  return direction === Direction.CALL ? Direction.PUT : Direction.CALL;
}

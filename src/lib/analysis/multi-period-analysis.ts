/**
 * Motor da Análise Plus (Multi-Period Analysis) — seções 1-3, 17-19 do
 * briefing.
 *
 * Ao contrário da análise de período único (`pattern-analyzer.ts` +
 * `run-analysis.ts`), aqui um "padrão" é avaliado em VÁRIAS janelas que
 * terminam todas na mesma data de referência (janelas encaixadas — seção
 * 18), e o resultado final é um único Confidence Score combinando
 * persistência, frequência, estabilidade, amostra e momentum
 * (`multi-period-scoring.ts`).
 *
 * Desempenho (seção 17): os candles são buscados UMA ÚNICA VEZ pelo
 * chamador (o período máximo, `maxDays`) — este módulo nunca consulta banco.
 * As janelas menores são derivadas em memória filtrando o array de
 * `occurrences` (já calculado uma vez por `analyzeAllSlots`) por data, o que
 * é barato porque `occurrences` tem no máximo ~`maxDays` entradas por slot.
 *
 * Sem look-ahead (seção 19): todas as janelas usam `referenceDate` como
 * ponto de corte — o motor é uma função pura (candles + config +
 * referenceDate) → resultados, então o mesmo código serve tanto para "análise
 * de agora" (referenceDate = hoje) quanto para um futuro motor de backtest
 * (referenceDate = uma data simulada no passado), sem qualquer mudança.
 */
import { Decimal } from "decimal.js";
import { DateTime } from "luxon";
import { Candle, Direction, DojiPolicy } from "@/lib/core/candle-classifier";
import { DailyOccurrence, TimeOfDay } from "@/lib/core/pattern-analyzer";
import {
  Classification,
  ConfidenceScoreResult,
  InversionState,
  MomentumTrend,
  ScoringConfig,
  StructuralWindowFrequency,
  oppositeDirection,
  scoreConfidence,
} from "@/lib/core/multi-period-scoring";
import { analyzeAllSlots } from "./run-analysis";

export interface MultiPeriodWindowResult {
  days: number;
  /** true apenas para a janela fixa de momentum (40D por padrão) — nunca entra nas contas estruturais. */
  isMomentum: boolean;
  /** % de ocorrências, dentro da janela, na direção do padrão. */
  frequency: Decimal;
  validSamples: number;
  callCount: number;
  putCount: number;
  dojiCount: number;
  occurrences: DailyOccurrence[];
}

export interface MultiPeriodPatternResult {
  symbol: string;
  timeframe: string;
  timeOfDay: TimeOfDay;
  timezone: string;
  direction: Direction.CALL | Direction.PUT;
  /** Janelas estruturais (>= minStructuralDays), da maior pra menor. */
  windows: MultiPeriodWindowResult[];
  /** Janela de momentum (40D por padrão) — só serve pra detectar fortalecimento/enfraquecimento/inversão. */
  momentumWindow: MultiPeriodWindowResult;
  /** % da direção OPOSTA na janela de momentum — não é `100 - momentumWindow.frequency` (doji pode entrar na amostra dependendo da política). */
  momentumOppositeFrequency: Decimal;
  structuralAverage: Decimal;
  confidenceScore: number;
  classification: Classification;
  recommendation: ConfidenceScoreResult["recommendation"];
  momentumTrend: MomentumTrend;
  inversion: InversionState;
  persistence: { confirmed: number; total: number; percentage: Decimal };
  stability: { range: Decimal; standardDeviation: Decimal };
  /** Ocorrências válidas na MAIOR janela estrutural (o período completo pedido) — "quantos dias entraram na análise", mesmo sentido de `PatternResult.totalValid` no motor de período único. */
  totalValid: number;
  /** Menor amostra válida entre as janelas estruturais — usado SÓ pra pontuar o critério de amostra (seção 8), nunca pra exibir "dias válidos" (é deliberadamente conservador, não é o total). */
  sampleMin: number;
  scores: ConfidenceScoreResult["scores"];
}

export interface MultiPeriodAnalysisConfig {
  timeframe: string;
  timezone: string;
  startTime?: string | null;
  endTime?: string | null;
  weekdays?: number[] | null;
  dojiTolerancePct: Decimal;
  dojiPolicy: DojiPolicy;
  /** Período máximo da análise — múltiplo de 10, mínimo `scoringConfig.minStructuralDays` (50 por padrão). */
  maxDays: number;
  persistenceThresholdPct: Decimal;
  scoringConfig?: ScoringConfig;
}

/**
 * Gera as janelas estruturais descendo de 10 em 10 a partir de `maxDays` até
 * `minStructuralDays` (inclusive) — seção 1. Ex: maxDays=100,
 * minStructuralDays=50 → [100,90,80,70,60,50].
 */
export function buildStructuralWindowDays(maxDays: number, minStructuralDays: number): number[] {
  const days: number[] = [];
  for (let d = maxDays; d >= minStructuralDays; d -= 10) {
    days.push(d);
  }
  return days;
}

/** Valida a regra de negócio de `maxDays` (seção 1: sem limite máximo artificial, mas precisa caber pelo menos uma janela estrutural). */
export function isValidMaxDays(maxDays: number, minStructuralDays: number): boolean {
  return Number.isInteger(maxDays) && maxDays >= minStructuralDays && maxDays % 10 === 0;
}

/**
 * Modo "período específico": o usuário escolhe data inicial/final em vez de
 * "últimos N dias" — `maxDays` é derivado arredondando o intervalo PRA BAIXO
 * até o múltiplo de 10 mais próximo (nunca pra cima, pra nunca pedir mais
 * dias de candle do que o intervalo realmente tem). Ex: intervalo de 73 dias
 * → maxDays=70 (usa os 70 dias mais recentes dentro do intervalo pedido).
 */
export function resolveMaxDaysFromDateRange(startDate: Date, endDate: Date): number {
  const rangeDays = Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, Math.floor(rangeDays / 10) * 10);
}

function countByDirection(occurrences: DailyOccurrence[], direction: Direction): number {
  return occurrences.filter((o) => o.direction === direction).length;
}

function frequencyOf(occurrences: DailyOccurrence[], direction: Direction, dojiPolicy: DojiPolicy): Decimal {
  const validSamples =
    dojiPolicy === DojiPolicy.IGNORE
      ? occurrences.filter((o) => o.direction !== Direction.DOJI).length
      : occurrences.length;
  if (validSamples === 0) return new Decimal(0);
  return new Decimal(countByDirection(occurrences, direction)).div(validSamples).mul(100);
}

/**
 * Roda a Análise Plus sobre um dataset de candles JÁ CARREGADO (o período
 * máximo, buscado uma única vez pelo chamador). `referenceDate` é o ponto de
 * corte de TODAS as janelas — nunca usa candles depois dele.
 */
export function analyzeMultiPeriod(
  candles: Candle[],
  config: MultiPeriodAnalysisConfig,
  referenceDate: Date
): MultiPeriodPatternResult[] {
  const scoringConfig = config.scoringConfig;
  const minStructuralDays = scoringConfig?.minStructuralDays ?? 50;
  const momentumWindowDays = scoringConfig?.momentumWindowDays ?? 40;

  if (!isValidMaxDays(config.maxDays, minStructuralDays)) {
    throw new Error(
      `maxDays inválido (${config.maxDays}): precisa ser múltiplo de 10 e >= ${minStructuralDays}.`
    );
  }

  const structuralDays = buildStructuralWindowDays(config.maxDays, minStructuralDays);
  const referenceZoned = DateTime.fromJSDate(referenceDate, { zone: "utc" }).setZone(config.timezone);

  function cutoffISO(days: number): string {
    return referenceZoned.minus({ days }).toISODate()!;
  }

  // Guarda de segurança contra look-ahead (seção 19): mesmo que o chamador
  // passe candles além de `referenceDate` (não deveria — o service já busca
  // só até lá), o motor nunca deixa vazar dado "futuro" pro cálculo. Isso é
  // o que torna esta função seguramente reutilizável por um motor de
  // backtest depois, sem precisar mudar nada aqui.
  const boundedCandles = candles.filter((c) => c.openTime.getTime() <= referenceDate.getTime());

  // 1) descobre os slots (par+horário) e já calcula a janela máxima de uma vez
  const maxWindowSlots = analyzeAllSlots(boundedCandles, {
    timeframe: config.timeframe,
    timezone: config.timezone,
    startTime: config.startTime,
    endTime: config.endTime,
    weekdays: config.weekdays,
    dojiTolerancePct: config.dojiTolerancePct,
    dojiPolicy: config.dojiPolicy,
    // a Análise Plus faz seu PRÓPRIO julgamento de amostra (seção 8, piso
    // duro em `scoreConfidence`) — não filtra aqui pra não esconder slots
    // que ainda merecem aparecer com score baixo/DESCARTAR.
    minValidDays: 0,
  });

  const results: MultiPeriodPatternResult[] = [];

  for (const slot of maxWindowSlots) {
    if (slot.predominantDirection === null) continue; // nem dá pra escolher uma direção
    // predominantDirection nunca é DOJI (é sempre o maior entre callCount/putCount),
    // mas o tipo é `Direction | null` — este check é só pra o TS estreitar o tipo.
    if (slot.predominantDirection === Direction.DOJI) continue;
    const direction = slot.predominantDirection;
    const opposite = oppositeDirection(direction);

    function windowStatsFor(days: number): MultiPeriodWindowResult {
      const cutoff = cutoffISO(days);
      const occ = slot.occurrences.filter((o) => o.day >= cutoff);
      const callCount = countByDirection(occ, Direction.CALL);
      const putCount = countByDirection(occ, Direction.PUT);
      const dojiCount = countByDirection(occ, Direction.DOJI);
      const validSamples = config.dojiPolicy === DojiPolicy.IGNORE ? callCount + putCount : occ.length;
      const directionCount = direction === Direction.CALL ? callCount : putCount;
      const frequency = validSamples > 0 ? new Decimal(directionCount).div(validSamples).mul(100) : new Decimal(0);
      return {
        days,
        isMomentum: days === momentumWindowDays,
        frequency,
        validSamples,
        callCount,
        putCount,
        dojiCount,
        occurrences: occ,
      };
    }

    const windows = structuralDays.map(windowStatsFor);
    const momentumWindow = windowStatsFor(momentumWindowDays);

    function oppositeFrequencyOf(window: MultiPeriodWindowResult): Decimal {
      return frequencyOf(window.occurrences, opposite, config.dojiPolicy);
    }

    // janela estrutural mais recente (menor `days`) é a última da lista (gerada em ordem decrescente)
    const nearestStructural = windows[windows.length - 1];
    const farthestStructural = windows[0];
    const declining = farthestStructural
      ? nearestStructural.frequency.lt(farthestStructural.frequency)
      : false;

    const structuralFrequencies: StructuralWindowFrequency[] = windows.map((w) => ({
      days: w.days,
      frequency: w.frequency,
      validSamples: w.validSamples,
    }));

    const scoreResult = scoreConfidence({
      structuralWindows: structuralFrequencies,
      persistenceThresholdPct: config.persistenceThresholdPct,
      momentum: {
        momentumFrequency: momentumWindow.frequency,
        momentumOppositeFrequency: oppositeFrequencyOf(momentumWindow),
        nearestStructuralOppositeFrequency: oppositeFrequencyOf(nearestStructural),
        declining,
      },
      config: scoringConfig,
    });

    results.push({
      symbol: slot.symbol,
      timeframe: slot.timeframe,
      timeOfDay: slot.timeOfDay,
      timezone: slot.timezone,
      direction,
      windows,
      momentumWindow,
      momentumOppositeFrequency: oppositeFrequencyOf(momentumWindow),
      structuralAverage: scoreResult.structuralAverage,
      confidenceScore: scoreResult.confidenceScore,
      classification: scoreResult.classification,
      recommendation: scoreResult.recommendation,
      momentumTrend: scoreResult.momentumTrend,
      inversion: scoreResult.inversion,
      persistence: scoreResult.persistence,
      stability: scoreResult.stability,
      totalValid: farthestStructural.validSamples,
      sampleMin: scoreResult.sampleMin,
      scores: scoreResult.scores,
    });
  }

  return results;
}

/**
 * Seção 13 — TOP 5: ordena por Confidence Score DESC, com desempate por
 * persistência, estabilidade (menor range = mais estável), amostra e
 * frequência média — nunca simplesmente pelo maior percentual.
 */
export function selectTopPatterns(results: MultiPeriodPatternResult[], count = 5): MultiPeriodPatternResult[] {
  const sorted = [...results].sort((a, b) => {
    if (a.confidenceScore !== b.confidenceScore) return b.confidenceScore - a.confidenceScore;
    if (a.persistence.percentage.cmp(b.persistence.percentage) !== 0) {
      return b.persistence.percentage.cmp(a.persistence.percentage);
    }
    if (a.stability.range.cmp(b.stability.range) !== 0) {
      return a.stability.range.cmp(b.stability.range); // menor range = mais estável = melhor
    }
    if (a.sampleMin !== b.sampleMin) return b.sampleMin - a.sampleMin;
    return b.structuralAverage.cmp(a.structuralAverage);
  });
  return sorted.slice(0, count);
}

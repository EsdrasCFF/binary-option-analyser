/**
 * Calculadora de entradas com Martingale.
 *
 * Regra de recuperação (para cada nível N > 0):
 *   proximaEntrada = (perdasAcumuladas + lucroMinimoDesejado) / payoutDecimal
 *
 * Tudo em Decimal (decimal.js) para evitar erro de ponto flutuante em dinheiro.
 */
import { Decimal } from "decimal.js";

Decimal.set({ precision: 28 });

const CENT = new Decimal("0.01");

export const LEVEL_NAMES = [
  "Entrada inicial",
  "Martingale 1",
  "Martingale 2",
  "Martingale 3",
  "Martingale 4",
  "Martingale 5",
];

export const MAX_MARTINGALE_LEVELS = 5;

export class MartingaleValidationError extends Error {}

function roundCentsUp(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_UP);
}

export interface LevelResult {
  levelIndex: number; // 0 = entrada inicial, 1..5 = martingale
  levelName: string;
  entryValue: Decimal;
  accumulatedLossesBefore: Decimal;
  grossProfitIfWin: Decimal;
  netProfitAfterRecovery: Decimal;
  accumulatedExposure: Decimal;
  pctOfBankrollUsed: Decimal;
  remainingBalanceIfLost: Decimal;
  bankrollSupportsNextLevel: boolean;
}

export interface MartingaleResult {
  levels: LevelResult[];
  totalCapitalRequired: Decimal;
  maxExposure: Decimal;
  pctBankrollExposed: Decimal;
  lossIfAllLevelsFail: Decimal;
  bankrollAfterFullLoss: Decimal;
  recommendedMinimumBankroll: Decimal;
  maxLevelsSupportedByBankroll: number;
}

function validateCommon(
  payoutPct: Decimal,
  bankroll: Decimal,
  minProfit: Decimal,
  martingaleLevels: number,
  maxExposurePct?: Decimal
): void {
  if (payoutPct.lte(0)) throw new MartingaleValidationError("Payout deve ser maior que zero.");
  if (payoutPct.gt(100)) throw new MartingaleValidationError("Payout não pode ser maior que 100%.");
  if (bankroll.lte(0)) throw new MartingaleValidationError("Banca deve ser maior que zero.");
  if (minProfit.lt(0)) throw new MartingaleValidationError("Lucro mínimo não pode ser negativo.");
  if (martingaleLevels < 0 || martingaleLevels > MAX_MARTINGALE_LEVELS) {
    throw new MartingaleValidationError(
      `Quantidade de Martingales deve estar entre 0 e ${MAX_MARTINGALE_LEVELS}.`
    );
  }
  if (maxExposurePct !== undefined && !(maxExposurePct.gt(0) && maxExposurePct.lte(100))) {
    throw new MartingaleValidationError("Percentual máximo de exposição deve estar entre 0 e 100.");
  }
}

function computeLevels(
  initialEntry: Decimal,
  payoutDecimal: Decimal,
  minProfit: Decimal,
  martingaleLevels: number,
  bankroll: Decimal
): LevelResult[] {
  const levels: LevelResult[] = [];
  let accumulatedLosses = new Decimal(0);
  let accumulatedExposure = new Decimal(0);
  let entry = initialEntry;

  for (let i = 0; i <= martingaleLevels; i++) {
    if (i > 0) {
      const rawEntry = accumulatedLosses.plus(minProfit).div(payoutDecimal);
      entry = roundCentsUp(rawEntry);
      const netCheck = entry.mul(payoutDecimal).minus(accumulatedLosses);
      if (netCheck.lt(minProfit)) {
        entry = entry.plus(CENT);
      }
    }

    const grossProfit = entry.mul(payoutDecimal).toDecimalPlaces(2);
    const netProfitAfterRecovery = grossProfit.minus(accumulatedLosses).toDecimalPlaces(2);
    accumulatedExposure = accumulatedExposure.plus(entry);
    const pctBankroll = accumulatedExposure.div(bankroll).mul(100).toDecimalPlaces(2);
    const remainingIfLost = bankroll.minus(accumulatedExposure).toDecimalPlaces(2);

    levels.push({
      levelIndex: i,
      levelName: LEVEL_NAMES[i],
      entryValue: entry,
      accumulatedLossesBefore: accumulatedLosses.toDecimalPlaces(2),
      grossProfitIfWin: grossProfit,
      netProfitAfterRecovery,
      accumulatedExposure: accumulatedExposure.toDecimalPlaces(2),
      pctOfBankrollUsed: pctBankroll,
      remainingBalanceIfLost: remainingIfLost,
      bankrollSupportsNextLevel: true, // ajustado depois, com lookahead real
    });
    accumulatedLosses = accumulatedLosses.plus(entry);
  }

  return levels;
}

export interface CalculateMode1Params {
  bankroll: Decimal;
  payoutPct: Decimal;
  initialEntry: Decimal;
  minProfit: Decimal;
  martingaleLevels: number;
  maxExposurePct?: Decimal;
}

/** Modo 1: usuário informa a entrada inicial. */
export function calculateMode1(params: CalculateMode1Params): MartingaleResult {
  const { bankroll, payoutPct, initialEntry, minProfit, martingaleLevels, maxExposurePct } = params;
  validateCommon(payoutPct, bankroll, minProfit, martingaleLevels, maxExposurePct);
  if (initialEntry.lte(0)) throw new MartingaleValidationError("Entrada inicial deve ser maior que zero.");
  if (initialEntry.gt(bankroll)) {
    throw new MartingaleValidationError("Entrada inicial não pode ser maior que a banca.");
  }

  const payoutDecimal = payoutPct.div(100);
  const levels = computeLevels(initialEntry, payoutDecimal, minProfit, martingaleLevels, bankroll);
  return finalizeResult(levels, bankroll, maxExposurePct);
}

export interface CalculateMode2Params {
  bankroll: Decimal;
  payoutPct: Decimal;
  minProfit: Decimal;
  martingaleLevels: number;
  maxExposurePct: Decimal;
}

/**
 * Modo 2: busca binária pela maior entrada inicial cuja exposição total
 * (soma de todos os níveis) não ultrapasse maxExposurePct% da banca.
 */
export function calculateMode2(params: CalculateMode2Params): MartingaleResult {
  const { bankroll, payoutPct, minProfit, martingaleLevels, maxExposurePct } = params;
  validateCommon(payoutPct, bankroll, minProfit, martingaleLevels, maxExposurePct);
  const payoutDecimal = payoutPct.div(100);
  const maxExposure = bankroll.mul(maxExposurePct).div(100);

  let low = CENT;
  let high = bankroll;
  let bestLevels: LevelResult[] | null = null;

  for (let i = 0; i < 60; i++) {
    const mid = low.plus(high).div(2).toDecimalPlaces(2);
    if (mid.lte(0)) break;
    let candidate: LevelResult[];
    try {
      candidate = computeLevels(mid, payoutDecimal, minProfit, martingaleLevels, bankroll);
    } catch {
      high = mid.minus(CENT);
      continue;
    }
    const totalExposure = candidate[candidate.length - 1].accumulatedExposure;
    if (totalExposure.lte(maxExposure)) {
      bestLevels = candidate;
      low = mid.plus(CENT);
    } else {
      high = mid.minus(CENT);
    }
    if (high.lt(low)) break;
  }

  if (bestLevels === null) {
    throw new MartingaleValidationError(
      "Não foi possível encontrar uma entrada inicial que respeite o limite de exposição informado com os parâmetros atuais (payout, lucro mínimo e quantidade de Martingales)."
    );
  }

  return finalizeResult(bestLevels, bankroll, maxExposurePct);
}

function finalizeResult(
  levels: LevelResult[],
  bankroll: Decimal,
  maxExposurePct?: Decimal
): MartingaleResult {
  for (let i = 0; i < levels.length; i++) {
    if (i === levels.length - 1) {
      levels[i].bankrollSupportsNextLevel = true; // não há próximo nível
    } else {
      const nextExposure = levels[i + 1].accumulatedExposure;
      levels[i].bankrollSupportsNextLevel = nextExposure.lte(bankroll);
    }
  }

  const totalCapitalRequired = levels[levels.length - 1].accumulatedExposure;
  const maxExposure = totalCapitalRequired;
  const pctExposed = maxExposure.div(bankroll).mul(100).toDecimalPlaces(2);
  const lossIfAllFail = maxExposure;
  const bankrollAfterFullLoss = bankroll.minus(lossIfAllFail).toDecimalPlaces(2);
  const recommendedMinBankroll = totalCapitalRequired.mul("1.1").toDecimalPlaces(2);

  let maxLevelsSupported = 0;
  for (const lvl of levels) {
    if (lvl.accumulatedExposure.lte(bankroll)) {
      maxLevelsSupported = lvl.levelIndex;
    } else {
      break;
    }
  }

  if (totalCapitalRequired.gt(bankroll)) {
    throw new MartingaleValidationError(
      `Capital necessário (R$ ${totalCapitalRequired.toFixed(2)}) ultrapassa a banca informada (R$ ${bankroll.toFixed(2)}). Reduza a entrada inicial ou o número de níveis de Martingale.`
    );
  }
  if (maxExposurePct !== undefined) {
    const limit = bankroll.mul(maxExposurePct).div(100);
    if (totalCapitalRequired.gt(limit)) {
      throw new MartingaleValidationError(
        `Capital necessário (R$ ${totalCapitalRequired.toFixed(2)}) ultrapassa o limite de exposição configurado (${maxExposurePct}% da banca = R$ ${limit.toFixed(2)}).`
      );
    }
  }

  return {
    levels,
    totalCapitalRequired,
    maxExposure,
    pctBankrollExposed: pctExposed,
    lossIfAllLevelsFail: lossIfAllFail,
    bankrollAfterFullLoss,
    recommendedMinimumBankroll: recommendedMinBankroll,
    maxLevelsSupportedByBankroll: maxLevelsSupported,
  };
}

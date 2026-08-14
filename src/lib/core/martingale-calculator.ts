/**
 * Calculadora de entradas com Martingale.
 *
 * Regra de recuperação (para TODO nível, inclusive o nível 0 — perdas
 * acumuladas = 0 nesse caso):
 *   entrada = (perdasAcumuladas + lucroMínimo) / payoutDecimal
 *
 * O "lucro mínimo" não é digitado pelo usuário — o usuário informa quanto da
 * banca aceita expor no total (`maxExposurePct`) e a quantidade de níveis;
 * `calculateAutoRecovery` busca o MAIOR lucro mínimo cuja exposição total
 * (soma de todas as entradas, nível 0 ao último) caiba nesse percentual —
 * usa o máximo da margem de risco aceita, em vez de deixar exposição sobrando
 * ou estourar a banca com um valor chutado.
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

/** Entrada que, se vencer neste nível, recupera `perdasAcumuladas` e ainda lucra `minProfit`. */
function recoveryEntry(accumulatedLosses: Decimal, minProfit: Decimal, payoutDecimal: Decimal): Decimal {
  const rawEntry = accumulatedLosses.plus(minProfit).div(payoutDecimal);
  let entry = roundCentsUp(rawEntry);
  const netCheck = entry.mul(payoutDecimal).minus(accumulatedLosses);
  if (netCheck.lt(minProfit)) {
    entry = entry.plus(CENT);
  }
  return entry;
}

function computeLevels(
  minProfit: Decimal,
  payoutDecimal: Decimal,
  martingaleLevels: number,
  bankroll: Decimal
): LevelResult[] {
  const levels: LevelResult[] = [];
  let accumulatedLosses = new Decimal(0);
  let accumulatedExposure = new Decimal(0);

  for (let i = 0; i <= martingaleLevels; i++) {
    const entry = recoveryEntry(accumulatedLosses, minProfit, payoutDecimal);

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

export interface CalculateAutoRecoveryParams {
  bankroll: Decimal;
  payoutPct: Decimal;
  /** Percentual máximo da banca que a escada inteira (todos os níveis) pode consumir. */
  maxExposurePct: Decimal;
  martingaleLevels: number;
}

/**
 * Único modo de cálculo: usuário informa banca, payout, % máximo de
 * exposição e quantidade de níveis — o sistema descobre sozinho, por busca
 * binária, o maior lucro mínimo de recuperação cuja exposição total caiba
 * exatamente dentro desse percentual (nível 0 incluso, usando a mesma
 * fórmula de recuperação dos demais níveis).
 */
export function calculateAutoRecovery(params: CalculateAutoRecoveryParams): MartingaleResult {
  const { bankroll, payoutPct, maxExposurePct, martingaleLevels } = params;

  if (payoutPct.lte(0)) throw new MartingaleValidationError("Payout deve ser maior que zero.");
  if (payoutPct.gt(100)) throw new MartingaleValidationError("Payout não pode ser maior que 100%.");
  if (bankroll.lte(0)) throw new MartingaleValidationError("Banca deve ser maior que zero.");
  if (martingaleLevels < 0 || martingaleLevels > MAX_MARTINGALE_LEVELS) {
    throw new MartingaleValidationError(
      `Quantidade de Martingales deve estar entre 0 e ${MAX_MARTINGALE_LEVELS}.`
    );
  }
  if (!(maxExposurePct.gt(0) && maxExposurePct.lte(100))) {
    throw new MartingaleValidationError("Percentual máximo de exposição deve estar entre 0 e 100.");
  }

  const payoutDecimal = payoutPct.div(100);
  const maxExposure = bankroll.mul(maxExposurePct).div(100);

  // limite superior seguro: é o ponto em que o nível 0 sozinho já consumiria
  // todo o orçamento, então nenhum lucro mínimo maior que isso é viável.
  let low = CENT;
  let high = maxExposure.mul(payoutDecimal).toDecimalPlaces(2);
  let bestLevels: LevelResult[] | null = null;

  for (let i = 0; i < 60; i++) {
    if (high.lt(low)) break;
    const mid = low.plus(high).div(2).toDecimalPlaces(2);
    if (mid.lte(0)) break;

    const candidate = computeLevels(mid, payoutDecimal, martingaleLevels, bankroll);
    const totalExposure = candidate[candidate.length - 1].accumulatedExposure;
    if (totalExposure.lte(maxExposure)) {
      bestLevels = candidate;
      low = mid.plus(CENT);
    } else {
      high = mid.minus(CENT);
    }
  }

  if (bestLevels === null) {
    throw new MartingaleValidationError(
      `Mesmo com o lucro mínimo mais baixo possível (R$ 0,01), a soma das entradas para ${martingaleLevels} ` +
        `nível(is) de Martingale ultrapassa o limite de exposição configurado (${maxExposurePct}% da banca = ` +
        `R$ ${maxExposure.toFixed(2)}). Aumente a exposição máxima ou reduza os níveis de Martingale.`
    );
  }

  return finalizeResult(bestLevels, bankroll);
}

function finalizeResult(levels: LevelResult[], bankroll: Decimal): MartingaleResult {
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

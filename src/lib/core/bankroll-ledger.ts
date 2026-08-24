/**
 * Cálculo puro do gerenciamento de banca (planilha manual) — diferente do
 * motor de backtest, o resultado (vitória/derrota/empate) de cada linha vem
 * do usuário, não de candle histórico. Aqui só se converte esse resultado em
 * R$ de lucro/prejuízo.
 */
import { Decimal } from "decimal.js";

export type EntryResult = "win" | "loss" | "tie";

/**
 * Vitória: ganha o payout sobre a entrada (a entrada em si não é perdida).
 * Derrota: perde a entrada inteira. Empate: sem efeito na banca.
 */
export function computeEntryProfitLoss(entryValue: Decimal, payoutPct: Decimal, result: EntryResult): Decimal {
  if (result === "win") return entryValue.mul(payoutPct).div(100).toDecimalPlaces(2);
  if (result === "loss") return entryValue.neg();
  return new Decimal(0);
}

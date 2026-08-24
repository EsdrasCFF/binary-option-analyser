import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { computeEntryProfitLoss } from "../bankroll-ledger";

describe("computeEntryProfitLoss", () => {
  it("vitória: ganha o payout sobre a entrada, não perde a entrada", () => {
    const result = computeEntryProfitLoss(new Decimal("10.00"), new Decimal("85"), "win");
    expect(result.toFixed(2)).toBe("8.50");
  });

  it("derrota: perde a entrada inteira", () => {
    const result = computeEntryProfitLoss(new Decimal("10.00"), new Decimal("85"), "loss");
    expect(result.toFixed(2)).toBe("-10.00");
  });

  it("empate: sem efeito", () => {
    const result = computeEntryProfitLoss(new Decimal("10.00"), new Decimal("85"), "tie");
    expect(result.toFixed(2)).toBe("0.00");
  });

  it("arredonda o lucro em vitória pra 2 casas decimais", () => {
    const result = computeEntryProfitLoss(new Decimal("7.33"), new Decimal("87"), "win");
    // 7.33 * 0.87 = 6.3771 -> 6.38
    expect(result.toFixed(2)).toBe("6.38");
  });

  it("payout diferente de 100 não afeta o valor perdido numa derrota", () => {
    const result = computeEntryProfitLoss(new Decimal("25.50"), new Decimal("50"), "loss");
    expect(result.toFixed(2)).toBe("-25.50");
  });
});

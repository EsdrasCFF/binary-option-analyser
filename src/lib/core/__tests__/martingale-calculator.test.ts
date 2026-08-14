import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { calculateAutoRecovery, MartingaleValidationError } from "../martingale-calculator";

describe("calculateAutoRecovery", () => {
  it("acha o maior lucro mínimo cuja exposição total cabe no percentual de exposição informado", () => {
    const result = calculateAutoRecovery({
      bankroll: new Decimal("1000"),
      payoutPct: new Decimal("85"),
      martingaleLevels: 3,
      maxExposurePct: new Decimal("20"),
    });
    const maxAllowed = new Decimal("200.00"); // 20% de 1000
    expect(result.totalCapitalRequired.lte(maxAllowed)).toBe(true);
    // usa o máximo possível da margem de risco aceita, não sobra exposição à toa
    expect(result.totalCapitalRequired.gte(maxAllowed.mul("0.95"))).toBe(true);
  });

  it("o nível 0 segue a MESMA fórmula de recuperação dos demais níveis (não é mais digitado à parte)", () => {
    const result = calculateAutoRecovery({
      bankroll: new Decimal("1000"),
      payoutPct: new Decimal("85"),
      martingaleLevels: 2,
      maxExposurePct: new Decimal("20"),
    });
    // como perdasAcumuladas=0 no nível 0, netProfitAfterRecovery do nível 0 É o lucro
    // mínimo descoberto — todo nível converge pro mesmo valor, a menos de 2 centavos
    // de folga do arredondamento pra cima em cascata.
    const target = result.levels[0].netProfitAfterRecovery;
    for (const lvl of result.levels) {
      expect(lvl.netProfitAfterRecovery.gte(target.minus("0.02"))).toBe(true);
      expect(lvl.netProfitAfterRecovery.lte(target.plus("0.02"))).toBe(true);
    }
  });

  it("cada nível recupera exatamente as perdas acumuladas antes dele", () => {
    const result = calculateAutoRecovery({
      bankroll: new Decimal("1000"),
      payoutPct: new Decimal("85"),
      martingaleLevels: 2,
      maxExposurePct: new Decimal("20"),
    });
    expect(result.levels[0].accumulatedLossesBefore.toFixed(2)).toBe("0.00");
    expect(result.levels[1].accumulatedLossesBefore.toFixed(2)).toBe(result.levels[0].entryValue.toFixed(2));
    expect(result.levels[2].accumulatedLossesBefore.toFixed(2)).toBe(
      result.levels[0].entryValue.plus(result.levels[1].entryValue).toFixed(2)
    );
  });

  it("0 níveis retorna só a entrada inicial, também pela fórmula de recuperação", () => {
    const result = calculateAutoRecovery({
      bankroll: new Decimal("500"),
      payoutPct: new Decimal("90"),
      martingaleLevels: 0,
      maxExposurePct: new Decimal("10"),
    });
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].levelName).toBe("Entrada inicial");
    expect(result.levels[0].accumulatedLossesBefore.toFixed(2)).toBe("0.00");
    expect(result.totalCapitalRequired.lte(new Decimal("50.00"))).toBe(true);
  });

  it("rejeita mais de 5 níveis de martingale", () => {
    expect(() =>
      calculateAutoRecovery({
        bankroll: new Decimal("1000"),
        payoutPct: new Decimal("85"),
        martingaleLevels: 6,
        maxExposurePct: new Decimal("20"),
      })
    ).toThrow(MartingaleValidationError);
  });

  it("rejeita payout zero ou negativo", () => {
    expect(() =>
      calculateAutoRecovery({
        bankroll: new Decimal("1000"),
        payoutPct: new Decimal("0"),
        martingaleLevels: 2,
        maxExposurePct: new Decimal("20"),
      })
    ).toThrow(MartingaleValidationError);
  });

  it("rejeita payout acima de 100", () => {
    expect(() =>
      calculateAutoRecovery({
        bankroll: new Decimal("1000"),
        payoutPct: new Decimal("150"),
        martingaleLevels: 2,
        maxExposurePct: new Decimal("20"),
      })
    ).toThrow(MartingaleValidationError);
  });

  it("rejeita percentual de exposição fora de 0-100", () => {
    expect(() =>
      calculateAutoRecovery({
        bankroll: new Decimal("1000"),
        payoutPct: new Decimal("85"),
        martingaleLevels: 2,
        maxExposurePct: new Decimal("0"),
      })
    ).toThrow(MartingaleValidationError);
    expect(() =>
      calculateAutoRecovery({
        bankroll: new Decimal("1000"),
        payoutPct: new Decimal("85"),
        martingaleLevels: 2,
        maxExposurePct: new Decimal("150"),
      })
    ).toThrow(MartingaleValidationError);
  });

  it("rejeita quando nem R$0,01 de lucro mínimo cabe no orçamento de exposição", () => {
    expect(() =>
      calculateAutoRecovery({
        bankroll: new Decimal("1"),
        payoutPct: new Decimal("85"),
        martingaleLevels: 0,
        maxExposurePct: new Decimal("0.01"), // 0,01% de R$1 = R$0,0001 — nem 1 centavo cabe
      })
    ).toThrow(MartingaleValidationError);
  });

  it("arredondamento para cima nunca deixa a exposição total estourar o percentual (payout 'feio')", () => {
    const result = calculateAutoRecovery({
      bankroll: new Decimal("5000"),
      payoutPct: new Decimal("73"),
      martingaleLevels: 5,
      maxExposurePct: new Decimal("15"),
    });
    expect(result.totalCapitalRequired.lte(new Decimal("750.00"))).toBe(true);
    for (const lvl of result.levels) {
      expect(lvl.netProfitAfterRecovery.gte(0)).toBe(true);
    }
  });

  it("banca após perda total = banca - exposição total", () => {
    const result = calculateAutoRecovery({
      bankroll: new Decimal("1000"),
      payoutPct: new Decimal("85"),
      martingaleLevels: 3,
      maxExposurePct: new Decimal("20"),
    });
    const expected = new Decimal("1000").minus(result.totalCapitalRequired);
    expect(result.bankrollAfterFullLoss.toFixed(2)).toBe(expected.toFixed(2));
  });
});

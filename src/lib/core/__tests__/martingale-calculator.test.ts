import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import {
  calculateMode1,
  calculateMode2,
  MartingaleValidationError,
} from "../martingale-calculator";

describe("calculateMode1", () => {
  it("reproduz o exemplo do enunciado: payout 85%, entrada R$5, lucro mínimo R$1", () => {
    const result = calculateMode1({
      bankroll: new Decimal("1000"),
      payoutPct: new Decimal("85"),
      initialEntry: new Decimal("5.00"),
      minProfit: new Decimal("1.00"),
      martingaleLevels: 2,
    });
    const levels = result.levels;

    expect(levels[0].entryValue.toFixed(2)).toBe("5.00");
    expect(levels[0].grossProfitIfWin.toFixed(2)).toBe("4.25");

    // Martingale 1: (5 + 1) / 0.85 = 7.0588... -> arredonda para cima -> 7.06
    expect(levels[1].entryValue.toFixed(2)).toBe("7.06");
    expect(levels[1].accumulatedLossesBefore.toFixed(2)).toBe("5.00");

    // Martingale 2: perdas acumuladas = 5 + 7.06 = 12.06; (12.06+1)/0.85 = 15.3647 -> 15.37
    expect(levels[2].accumulatedLossesBefore.toFixed(2)).toBe("12.06");
    expect(levels[2].entryValue.toFixed(2)).toBe("15.37");
  });

  it("todo nível recupera perdas + lucro mínimo", () => {
    const result = calculateMode1({
      bankroll: new Decimal("2000"),
      payoutPct: new Decimal("80"),
      initialEntry: new Decimal("10.00"),
      minProfit: new Decimal("2.00"),
      martingaleLevels: 5,
    });
    for (const lvl of result.levels) {
      expect(lvl.netProfitAfterRecovery.gte("2.00")).toBe(true);
    }
  });

  it("zero martingales retorna só a entrada inicial", () => {
    const result = calculateMode1({
      bankroll: new Decimal("500"),
      payoutPct: new Decimal("90"),
      initialEntry: new Decimal("20.00"),
      minProfit: new Decimal("0"),
      martingaleLevels: 0,
    });
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].levelName).toBe("Entrada inicial");
  });

  it("rejeita mais de 5 níveis de martingale", () => {
    expect(() =>
      calculateMode1({
        bankroll: new Decimal("1000"),
        payoutPct: new Decimal("85"),
        initialEntry: new Decimal("5.00"),
        minProfit: new Decimal("1.00"),
        martingaleLevels: 6,
      })
    ).toThrow(MartingaleValidationError);
  });

  it("rejeita payout zero ou negativo", () => {
    expect(() =>
      calculateMode1({
        bankroll: new Decimal("1000"),
        payoutPct: new Decimal("0"),
        initialEntry: new Decimal("5.00"),
        minProfit: new Decimal("1.00"),
        martingaleLevels: 2,
      })
    ).toThrow(MartingaleValidationError);
  });

  it("rejeita payout acima de 100", () => {
    expect(() =>
      calculateMode1({
        bankroll: new Decimal("1000"),
        payoutPct: new Decimal("150"),
        initialEntry: new Decimal("5.00"),
        minProfit: new Decimal("1.00"),
        martingaleLevels: 2,
      })
    ).toThrow(MartingaleValidationError);
  });

  it("rejeita entrada inicial maior que a banca", () => {
    expect(() =>
      calculateMode1({
        bankroll: new Decimal("100"),
        payoutPct: new Decimal("85"),
        initialEntry: new Decimal("200"),
        minProfit: new Decimal("1.00"),
        martingaleLevels: 1,
      })
    ).toThrow(MartingaleValidationError);
  });

  it("rejeita quando capital necessário ultrapassa a banca", () => {
    expect(() =>
      calculateMode1({
        bankroll: new Decimal("50"),
        payoutPct: new Decimal("70"),
        initialEntry: new Decimal("10.00"),
        minProfit: new Decimal("5.00"),
        martingaleLevels: 5,
      })
    ).toThrow(MartingaleValidationError);
  });

  it("arredondamento para cima nunca sub-recupera (payout 'feio')", () => {
    const result = calculateMode1({
      bankroll: new Decimal("5000"),
      payoutPct: new Decimal("73"),
      initialEntry: new Decimal("3.33"),
      minProfit: new Decimal("0.50"),
      martingaleLevels: 5,
    });
    for (const lvl of result.levels.slice(1)) {
      expect(lvl.netProfitAfterRecovery.gte("0.50")).toBe(true);
    }
  });

  it("banca após perda total = banca - exposição total", () => {
    const result = calculateMode1({
      bankroll: new Decimal("1000"),
      payoutPct: new Decimal("85"),
      initialEntry: new Decimal("10.00"),
      minProfit: new Decimal("1.00"),
      martingaleLevels: 3,
    });
    const expected = new Decimal("1000").minus(result.totalCapitalRequired);
    expect(result.bankrollAfterFullLoss.toFixed(2)).toBe(expected.toFixed(2));
  });
});

describe("calculateMode2", () => {
  it("encontra a maior entrada dentro do limite de exposição", () => {
    const result = calculateMode2({
      bankroll: new Decimal("1000"),
      payoutPct: new Decimal("85"),
      minProfit: new Decimal("1.00"),
      martingaleLevels: 3,
      maxExposurePct: new Decimal("20"),
    });
    const maxAllowed = new Decimal("200.00");
    expect(result.totalCapitalRequired.lte(maxAllowed)).toBe(true);
    expect(result.totalCapitalRequired.gte(maxAllowed.mul("0.95"))).toBe(true);
  });

  it("é consistente com o modo 1 usando a entrada encontrada", () => {
    const mode2 = calculateMode2({
      bankroll: new Decimal("1000"),
      payoutPct: new Decimal("85"),
      minProfit: new Decimal("1.00"),
      martingaleLevels: 2,
      maxExposurePct: new Decimal("30"),
    });
    const initialEntryFound = mode2.levels[0].entryValue;
    const mode1 = calculateMode1({
      bankroll: new Decimal("1000"),
      payoutPct: new Decimal("85"),
      initialEntry: initialEntryFound,
      minProfit: new Decimal("1.00"),
      martingaleLevels: 2,
    });
    expect(mode1.totalCapitalRequired.toFixed(2)).toBe(mode2.totalCapitalRequired.toFixed(2));
  });
});

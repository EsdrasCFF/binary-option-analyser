/**
 * Exemplo de integração real entre o App Router e o motor de domínio:
 * recebe os parâmetros da Calculadora de Entradas, valida com Zod, e chama
 * diretamente as funções de src/lib/core/martingale-calculator.ts — sem
 * rede, sem segundo serviço, mesmo processo.
 *
 * POST /api/martingale-calculations
 * body (modo 1):
 *   { "mode": "initial_entry", "bankroll": "1000", "payoutPct": "85",
 *     "initialEntry": "5.00", "minProfit": "1.00", "martingaleLevels": 2 }
 * body (modo 2):
 *   { "mode": "auto_split", "bankroll": "1000", "payoutPct": "85",
 *     "minProfit": "1.00", "martingaleLevels": 2, "maxExposurePct": "20" }
 */
import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { z } from "zod";
import {
  calculateMode1,
  calculateMode2,
  MartingaleValidationError,
} from "@/lib/core/martingale-calculator";
import { ApiError, decimalString, handleErrors, parseJsonBody, serializeDecimals } from "@/lib/api/http";

const bodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("initial_entry"),
    bankroll: decimalString,
    payoutPct: decimalString,
    initialEntry: decimalString,
    minProfit: decimalString,
    martingaleLevels: z.number().int().min(0).max(5),
    maxExposurePct: decimalString.optional(),
  }),
  z.object({
    mode: z.literal("auto_split"),
    bankroll: decimalString,
    payoutPct: decimalString,
    minProfit: decimalString,
    martingaleLevels: z.number().int().min(0).max(5),
    maxExposurePct: decimalString,
  }),
]);

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const body = await parseJsonBody(req, bodySchema);

    try {
      const result =
        body.mode === "initial_entry"
          ? calculateMode1({
              bankroll: new Decimal(body.bankroll),
              payoutPct: new Decimal(body.payoutPct),
              initialEntry: new Decimal(body.initialEntry),
              minProfit: new Decimal(body.minProfit),
              martingaleLevels: body.martingaleLevels,
              maxExposurePct: body.maxExposurePct ? new Decimal(body.maxExposurePct) : undefined,
            })
          : calculateMode2({
              bankroll: new Decimal(body.bankroll),
              payoutPct: new Decimal(body.payoutPct),
              minProfit: new Decimal(body.minProfit),
              martingaleLevels: body.martingaleLevels,
              maxExposurePct: new Decimal(body.maxExposurePct),
            });

      return NextResponse.json(serializeDecimals(result));
    } catch (e) {
      if (e instanceof MartingaleValidationError) {
        throw new ApiError(e.message, 422);
      }
      throw e;
    }
  });
}

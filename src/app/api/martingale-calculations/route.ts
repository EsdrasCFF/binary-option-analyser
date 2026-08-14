/**
 * Exemplo de integração real entre o App Router e o motor de domínio:
 * recebe os parâmetros da Calculadora de Entradas, valida com Zod, e chama
 * diretamente as funções de src/lib/core/martingale-calculator.ts — sem
 * rede, sem segundo serviço, mesmo processo.
 *
 * POST /api/martingale-calculations
 * body:
 *   { "bankroll": "1000", "payoutPct": "85", "martingaleLevels": 2,
 *     "maxExposurePct": "20" }
 *
 * Entrada inicial e lucro mínimo de recuperação não são informados — o
 * sistema descobre o maior lucro mínimo cuja exposição total caiba dentro de
 * `maxExposurePct` (ver `calculateAutoRecovery`).
 */
import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { calculateAutoRecovery, MartingaleValidationError } from "@/lib/core/martingale-calculator";
import { ApiError, decimalString, handleErrors, parseJsonBody, serializeDecimals } from "@/lib/api/http";

const bodySchema = z.object({
  bankroll: decimalString,
  payoutPct: decimalString,
  martingaleLevels: z.number().int().min(0).max(5),
  maxExposurePct: decimalString,
});

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const body = await parseJsonBody(req, bodySchema);

    try {
      const result = calculateAutoRecovery({
        bankroll: new Decimal(body.bankroll),
        payoutPct: new Decimal(body.payoutPct),
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

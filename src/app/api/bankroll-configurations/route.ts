/**
 * POST /api/bankroll-configurations — salva um preset de banca/payout
 * (reaproveitável na Calculadora de Entradas e na criação de Backtests).
 * GET  /api/bankroll-configurations — lista os presets do usuário.
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { bankrollConfigurations } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { decimalString, handleErrors, parseJsonBody } from "@/lib/api/http";

const bodySchema = z.object({
  name: z.string().min(1).max(255),
  bankroll: decimalString,
  payoutPct: decimalString,
  maxExposurePct: decimalString.optional(),
});

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const body = await parseJsonBody(req, bodySchema);

    const [config] = await db
      .insert(bankrollConfigurations)
      .values({
        userId,
        name: body.name,
        bankroll: body.bankroll,
        payoutPct: body.payoutPct,
        maxExposurePct: body.maxExposurePct ?? null,
      })
      .returning();

    return NextResponse.json(config, { status: 201 });
  });
}

export async function GET(_req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const items = await db
      .select()
      .from(bankrollConfigurations)
      .where(eq(bankrollConfigurations.userId, userId))
      .orderBy(desc(bankrollConfigurations.createdAt));
    return NextResponse.json({ items });
  });
}

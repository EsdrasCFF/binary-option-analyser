/** DELETE /api/bankroll-configurations/:id — remove um preset de banca. */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { bankrollConfigurations } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, isUuid } from "@/lib/api/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new ApiError("Identificador inválido (esperado UUID).", 400);

    const [existing] = await db
      .select({ id: bankrollConfigurations.id })
      .from(bankrollConfigurations)
      .where(and(eq(bankrollConfigurations.id, id), eq(bankrollConfigurations.userId, userId)))
      .limit(1);
    if (!existing) throw new ApiError("Configuração de banca não encontrada.", 404);

    await db.delete(bankrollConfigurations).where(eq(bankrollConfigurations.id, id));
    return new NextResponse(null, { status: 204 });
  });
}

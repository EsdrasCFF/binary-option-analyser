/**
 * GET /api/data-providers — lista as fontes de dados do usuário (criadas
 * implicitamente pelas rotas de importação: "Importação CSV", "Yahoo
 * Finance", etc). Somente leitura por enquanto — não há necessidade de criar
 * uma manualmente, as rotas de importação resolvem/criam sozinhas.
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { dataProviders } from "@/db/schema";
import { requireUserId } from "@/lib/api/current-user";
import { handleErrors } from "@/lib/api/http";

export async function GET(_req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId();
    const items = await db
      .select()
      .from(dataProviders)
      .where(eq(dataProviders.userId, userId))
      .orderBy(desc(dataProviders.createdAt));
    return NextResponse.json({ items });
  });
}

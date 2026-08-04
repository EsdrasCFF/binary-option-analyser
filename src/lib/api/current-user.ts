/**
 * ⚠️ PLACEHOLDER DE AUTENTICAÇÃO — NÃO É AUTENTICAÇÃO REAL.
 *
 * A Fase 2 do roadmap precisa de rotas que gravam dados por usuário, mas a
 * autenticação (next-auth ou JWT) ainda não foi implementada. Em vez de deixar
 * as rotas sem dono (o que quebraria as foreign keys) ou de inventar um "user
 * padrão" invisível, este módulo resolve o usuário atual de forma explícita e
 * SÓ funciona em desenvolvimento:
 *
 *   - cabeçalho `x-user-id: <uuid>` (útil para testar múltiplos usuários), ou
 *   - variável de ambiente `DEV_USER_ID`.
 *
 * Em produção (`NODE_ENV === "production"`) qualquer chamada falha com 501,
 * justamente para que seja impossível subir isto como se fosse autenticação —
 * um header controlado pelo cliente permitiria personificar qualquer usuário.
 *
 * Ao implementar a autenticação de verdade, basta trocar o corpo de
 * `requireUserId` pela leitura da sessão/JWT: nenhuma rota precisa mudar.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { ApiError, isUuid } from "./http";

export async function requireUserId(req: Request): Promise<string> {
  if (process.env.NODE_ENV === "production") {
    throw new ApiError(
      "Autenticação não implementada: estas rotas não podem ser usadas em produção até a fase de autenticação ser concluída.",
      501
    );
  }

  const candidate = req.headers.get("x-user-id") ?? process.env.DEV_USER_ID ?? null;
  if (!candidate) {
    throw new ApiError(
      "Não autenticado. Em desenvolvimento, envie o cabeçalho `x-user-id` ou defina DEV_USER_ID no .env.local.",
      401
    );
  }
  if (!isUuid(candidate)) {
    throw new ApiError("Identificador de usuário inválido (esperado UUID).", 401);
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, candidate))
    .limit(1);

  if (!user) {
    throw new ApiError("Usuário não encontrado.", 401);
  }
  return user.id;
}

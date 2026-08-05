/**
 * Resolve o usuário autenticado via Auth.js (ver src/auth.ts). `session.user.id`
 * é o UUID interno de `users` (não o `sub` do Google) — ver o callback `jwt`
 * em src/auth.ts para como esse mapeamento é feito no login.
 */
import { auth } from "@/auth";
import { ApiError } from "./http";

export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new ApiError("Não autenticado. Faça login em /api/auth/signin.", 401);
  }
  return session.user.id;
}

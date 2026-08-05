/**
 * Configuração central do Auth.js v5 (next-auth@beta). Único provider por
 * enquanto: Google — plano é ampliar com outros providers depois.
 *
 * Estratégia: sessão em JWT (sem tabelas `accounts`/`sessions` do adapter
 * oficial do Auth.js). No callback `jwt`, no primeiro login, resolvemos (ou
 * criamos) a linha correspondente em `users` por e-mail e gravamos o UUID
 * interno no token — é esse UUID, não o `sub` do Google, que vira
 * `session.user.id` e é usado em toda foreign key do sistema
 * (`analyses.userId`, `backtests.userId` etc.).
 *
 * `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`/`AUTH_SECRET` são lidos automaticamente
 * do ambiente pela convenção de nomes do Auth.js v5 (ver .env.example).
 */
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, user }) {
      // só roda no login (account presente); nas renovações seguintes o uid já está no token
      if (account && user?.email) {
        const [existing] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, user.email))
          .limit(1);

        if (existing) {
          token.uid = existing.id;
        } else {
          const [created] = await db
            .insert(users)
            .values({ email: user.email, name: user.name ?? user.email })
            .returning({ id: users.id });
          token.uid = created.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.uid === "string") {
        session.user.id = token.uid;
      }
      return session;
    },
  },
});

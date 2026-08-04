/**
 * Cliente de banco de dados: Drizzle ORM + driver serverless do Neon.
 *
 * Uso dentro de Route Handlers / Server Actions do Next.js:
 *
 *   import { db } from "@/db/client";
 *   import { currencyPairs } from "@/db/schema";
 *
 *   const pairs = await db.select().from(currencyPairs);
 *
 * A variável de ambiente DATABASE_URL deve apontar para a connection string
 * do Neon (formato: postgres://user:pass@ep-xxxx.neon.tech/db?sslmode=require).
 * Nunca comitar esse valor — usar .env.local (Next) e variáveis de ambiente
 * do provedor de deploy em produção.
 *
 * A conexão é criada preguiçosamente (no primeiro uso), não na importação do
 * módulo: o `next build` importa todos os Route Handlers para coletar as
 * rotas, e não deve exigir um banco configurado só para compilar.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Database = NeonHttpDatabase<typeof schema>;

let instance: Database | null = null;

export function getDb(): Database {
  if (instance) return instance;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL não configurada. Defina em .env.local (dev) ou nas variáveis de ambiente do deploy."
    );
  }

  instance = drizzle(neon(connectionString), { schema });
  return instance;
}

/**
 * Fachada com a mesma API do Drizzle: cada acesso resolve a instância real,
 * criando a conexão apenas quando uma query é de fato executada.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const real = getDb();
    const value = Reflect.get(real, property, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

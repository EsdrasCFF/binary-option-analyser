/**
 * Utilitários compartilhados pelos Route Handlers.
 *
 * Objetivo: manter todas as rotas com o mesmo formato de erro, a mesma
 * serialização de Decimal e os mesmos validadores básicos, para que o
 * frontend (Fase 5) possa tratar respostas de forma uniforme.
 */
import { NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { z } from "zod";

/** Erro esperado de negócio/validação: vira resposta JSON com status próprio. */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Envolve o corpo de um Route Handler convertendo ApiError em resposta JSON.
 * Erros inesperados viram 500 sem vazar stack trace para o cliente.
 */
export async function handleErrors(
  fn: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json(
        e.details === undefined ? { error: e.message } : { error: e.message, details: e.details },
        { status: e.status }
      );
    }
    console.error("[api] erro inesperado:", e);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}

/**
 * Serializa Decimal -> string em toda a árvore de resposta, para JSON seguro
 * (nunca converter para Number, que perderia precisão).
 */
export function serializeDecimals(value: unknown, decimalPlaces = 2): unknown {
  if (value instanceof Decimal) return value.toFixed(decimalPlaces);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => serializeDecimals(v, decimalPlaces));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serializeDecimals(v, decimalPlaces)])
    );
  }
  return value;
}

/**
 * Valores numéricos trafegam como string na API para preservar precisão
 * decimal ponta a ponta (mesma convenção do numeric do Postgres).
 */
export const decimalString = z
  .string()
  .refine((v) => v.trim() !== "" && !Number.isNaN(Number(v)), {
    message: "Deve ser um número válido (string, para preservar precisão decimal).",
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidString = z.string().regex(UUID_RE, "UUID inválido.");

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Data/hora ISO 8601 aceita pelo Date do JS. */
export const isoDateTimeString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Data/hora ISO inválida." });

/** Horário no formato "HH:mm" (24h). */
export const timeOfDayString = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Horário deve estar no formato "HH:mm".');

/** Faz o parse do body JSON com um schema Zod, lançando ApiError 400. */
export async function parseJsonBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError("Corpo da requisição inválido.", 400, parsed.error.flatten());
  }
  return parsed.data;
}

/** Faz o parse da query string com um schema Zod, lançando ApiError 400. */
export function parseSearchParams<T>(url: URL, schema: z.ZodType<T>): T {
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("Parâmetros de consulta inválidos.", 400, parsed.error.flatten());
  }
  return parsed.data;
}

/** Insere em lotes: o driver HTTP do Neon não gosta de statements gigantes. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

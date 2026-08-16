/**
 * Fetch wrapper compartilhado pelo cliente de API do frontend. Fala com as
 * próprias rotas do Next (`same-origin`), então o cookie de sessão do
 * Auth.js já vai junto automaticamente — não precisa de token manual.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message = (body && typeof body === "object" && "error" in body && String(body.error)) || res.statusText;
    throw new ApiClientError(message, res.status, body && typeof body === "object" ? (body as { details?: unknown }).details : undefined);
  }
  return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
}

export function apiDelete<T = void>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

/** POST multipart/form-data — usado só pela importação de CSV. */
export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body: form });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const message = (body && typeof body === "object" && "error" in body && String(body.error)) || res.statusText;
    throw new ApiClientError(message, res.status, body && typeof body === "object" ? (body as { details?: unknown }).details : undefined);
  }
  return body as T;
}

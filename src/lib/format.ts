/**
 * Formatação de exibição. Os valores chegam como string da API (convenção
 * de precisão decimal ponta a ponta) — aqui é a ÚNICA camada onde viram
 * `Number` para formatação, nunca para cálculo.
 */
import { DateTime } from "luxon";

export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

export function formatPercent(value: string | number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(decimals)}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const dt = typeof value === "string" ? DateTime.fromISO(value) : DateTime.fromJSDate(value);
  return dt.setLocale("pt-BR").toFormat("dd/MM/yyyy");
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const dt = typeof value === "string" ? DateTime.fromISO(value) : DateTime.fromJSDate(value);
  return dt.setLocale("pt-BR").toFormat("dd/MM/yyyy HH:mm");
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  processing: "Processando",
  completed: "Concluído",
  error: "Erro",
  cancelled: "Cancelado",
  forte_e_ativo: "Forte e ativo",
  ativo: "Ativo",
  perdendo_forca: "Perdendo força",
  inativo: "Inativo",
  amostra_insuficiente: "Amostra insuficiente",
  win: "Vitória",
  loss: "Derrota",
  tie: "Empate",
};

export function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatDirection(direction: string | null): string {
  if (!direction) return "—";
  return direction; // CALL/PUT/DOJI já são exibíveis como estão
}

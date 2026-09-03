import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "./http";
import { BacktestPlusDetail, BacktestPlusSummary, CreateBacktestPlusInput, CreateBacktestPlusResult } from "./types";

export function useBacktestPlusList() {
  return useQuery({
    queryKey: ["backtest-plus"],
    queryFn: () => apiGet<{ items: BacktestPlusSummary[] }>("/api/backtest-plus"),
  });
}

// Processamento roda dentro do próprio request de criação (mesmo padrão de
// Backtest/Análise Plus) — não há necessidade de polling aqui.
export function useBacktestPlus(id: string | undefined) {
  return useQuery({
    queryKey: ["backtest-plus", id],
    queryFn: () => apiGet<BacktestPlusDetail>(`/api/backtest-plus/${id}`),
    enabled: !!id,
  });
}

export function useCreateBacktestPlus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBacktestPlusInput) => apiPost<CreateBacktestPlusResult>("/api/backtest-plus", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backtest-plus"] });
    },
  });
}

export function useDeleteBacktestPlus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/backtest-plus/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backtest-plus"] });
    },
  });
}

export function useRenameBacktestPlus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiPatch<{ id: string }>(`/api/backtest-plus/${id}`, { name }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["backtest-plus"] });
      queryClient.invalidateQueries({ queryKey: ["backtest-plus", id] });
    },
  });
}

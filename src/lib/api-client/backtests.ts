import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "./http";
import { Backtest, BacktestOperation, CreateBacktestInput, CreateBacktestResult, PaginatedResult } from "./types";

export function useBacktests() {
  return useQuery({
    queryKey: ["backtests"],
    queryFn: () => apiGet<{ items: Backtest[] }>("/api/backtests"),
  });
}

export function useBacktest(id: string | undefined) {
  return useQuery({
    queryKey: ["backtests", id],
    queryFn: () => apiGet<Backtest>(`/api/backtests/${id}`),
    enabled: !!id,
  });
}

export function useBacktestOperations(
  id: string | undefined,
  query: { result?: "win" | "loss" | "tie"; limit?: number; offset?: number } = {}
) {
  const params = new URLSearchParams();
  if (query.result) params.set("result", query.result);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  const qs = params.toString();

  return useQuery({
    queryKey: ["backtests", id, "operations", query],
    queryFn: () => apiGet<PaginatedResult<BacktestOperation>>(`/api/backtests/${id}/operations${qs ? `?${qs}` : ""}`),
    enabled: !!id,
  });
}

export function useCreateBacktest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBacktestInput) => apiPost<CreateBacktestResult>("/api/backtests", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backtests"] });
    },
  });
}

export function useDeleteBacktest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/backtests/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backtests"] });
    },
  });
}

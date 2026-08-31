import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "./http";
import {
  CreateMultiPeriodAnalysisInput,
  CreateMultiPeriodAnalysisResult,
  MultiPeriodAnalysis,
  MultiPeriodAnalysisDetail,
  MultiPeriodPatternResultDetail,
  MultiPeriodPatternResultsQuery,
  MultiPeriodPatternResultSummary,
  PaginatedResult,
} from "./types";

function toSearchParams(query: MultiPeriodPatternResultsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useMultiPeriodAnalyses() {
  return useQuery({
    queryKey: ["multi-period-analyses"],
    queryFn: () => apiGet<{ items: MultiPeriodAnalysis[] }>("/api/multi-period-analyses"),
  });
}

export function useMultiPeriodAnalysis(id: string | undefined, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ["multi-period-analyses", id],
    queryFn: () => apiGet<MultiPeriodAnalysisDetail>(`/api/multi-period-analyses/${id}`),
    enabled: !!id,
    refetchInterval: options?.refetchInterval,
  });
}

export function useCreateMultiPeriodAnalysis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMultiPeriodAnalysisInput) =>
      apiPost<CreateMultiPeriodAnalysisResult>("/api/multi-period-analyses", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["multi-period-analyses"] });
    },
  });
}

export function useDeleteMultiPeriodAnalysis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/multi-period-analyses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["multi-period-analyses"] });
    },
  });
}

export function useMultiPeriodTop5(analysisId: string | undefined) {
  return useQuery({
    queryKey: ["multi-period-analyses", analysisId, "top5"],
    queryFn: () => apiGet<{ items: MultiPeriodPatternResultDetail[] }>(`/api/multi-period-analyses/${analysisId}/top5`),
    enabled: !!analysisId,
  });
}

export function useMultiPeriodPatternResults(query: MultiPeriodPatternResultsQuery) {
  return useQuery({
    queryKey: ["multi-period-pattern-results", query],
    queryFn: () =>
      apiGet<PaginatedResult<MultiPeriodPatternResultSummary>>(`/api/multi-period-pattern-results${toSearchParams(query)}`),
  });
}

export function useMultiPeriodPatternResult(id: string | undefined) {
  return useQuery({
    queryKey: ["multi-period-pattern-results", id],
    queryFn: () => apiGet<MultiPeriodPatternResultDetail>(`/api/multi-period-pattern-results/${id}`),
    enabled: !!id,
  });
}

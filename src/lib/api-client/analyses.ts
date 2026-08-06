import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "./http";
import { Analysis, AnalysisDetail, CreateAnalysisInput, CreateAnalysisResult } from "./types";

export function useAnalyses() {
  return useQuery({
    queryKey: ["analyses"],
    queryFn: () => apiGet<{ items: Analysis[] }>("/api/analyses"),
  });
}

export function useAnalysis(id: string | undefined, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ["analyses", id],
    queryFn: () => apiGet<AnalysisDetail>(`/api/analyses/${id}`),
    enabled: !!id,
    refetchInterval: options?.refetchInterval,
  });
}

export function useCreateAnalysis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAnalysisInput) => apiPost<CreateAnalysisResult>("/api/analyses", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
    },
  });
}

export function useDeleteAnalysis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/analyses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
    },
  });
}

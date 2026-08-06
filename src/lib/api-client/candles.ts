import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPostForm } from "./http";
import { ImportJob, ImportResult, YahooImportResult } from "./types";

export function useImportJobs() {
  return useQuery({
    queryKey: ["import-jobs"],
    queryFn: () => apiGet<{ items: ImportJob[] }>("/api/candles/import"),
  });
}

export interface ImportCsvInput {
  file: File;
  source?: string;
}

export function useImportCsv() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, source }: ImportCsvInput) => {
      const form = new FormData();
      form.append("file", file);
      if (source) form.append("source", source);
      return apiPostForm<ImportResult>("/api/candles/import", form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["currency-pairs"] });
      queryClient.invalidateQueries({ queryKey: ["data-providers"] });
    },
  });
}

export interface ImportYahooInput {
  symbols: string[];
  timeframe: string;
  from?: string;
  to?: string;
}

export function useImportYahoo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportYahooInput) => apiPost<YahooImportResult>("/api/candles/import-yahoo", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["currency-pairs"] });
      queryClient.invalidateQueries({ queryKey: ["data-providers"] });
    },
  });
}

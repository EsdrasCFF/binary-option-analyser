import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./http";
import { PaginatedResult, PatternResult, PatternResultsQuery } from "./types";

function toSearchParams(query: PatternResultsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function usePatternResults(query: PatternResultsQuery) {
  return useQuery({
    queryKey: ["pattern-results", query],
    queryFn: () => apiGet<PaginatedResult<PatternResult>>(`/api/pattern-results${toSearchParams(query)}`),
  });
}

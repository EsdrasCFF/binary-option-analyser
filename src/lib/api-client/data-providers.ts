import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./http";
import { DataProvider } from "./types";

export function useDataProviders() {
  return useQuery({
    queryKey: ["data-providers"],
    queryFn: () => apiGet<{ items: DataProvider[] }>("/api/data-providers"),
  });
}

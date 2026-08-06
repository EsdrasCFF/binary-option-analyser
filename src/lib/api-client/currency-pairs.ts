import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./http";
import { CurrencyPair } from "./types";

export function useCurrencyPairs() {
  return useQuery({
    queryKey: ["currency-pairs"],
    queryFn: () => apiGet<{ items: CurrencyPair[] }>("/api/currency-pairs"),
  });
}

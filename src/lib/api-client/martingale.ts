import { useMutation } from "@tanstack/react-query";
import { apiPost } from "./http";
import { MartingaleCalculationInput, MartingaleResult } from "./types";

export function useCalculateMartingale() {
  return useMutation({
    mutationFn: (input: MartingaleCalculationInput) =>
      apiPost<MartingaleResult>("/api/martingale-calculations", input),
  });
}

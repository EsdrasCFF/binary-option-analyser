import { useMutation } from "@tanstack/react-query";
import { apiPost } from "./http";
import { MartingaleMode1Input, MartingaleMode2Input, MartingaleResult } from "./types";

export function useCalculateMartingale() {
  return useMutation({
    mutationFn: (input: MartingaleMode1Input | MartingaleMode2Input) =>
      apiPost<MartingaleResult>("/api/martingale-calculations", input),
  });
}

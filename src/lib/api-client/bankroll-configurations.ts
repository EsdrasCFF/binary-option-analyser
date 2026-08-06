import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "./http";
import { BankrollConfiguration, CreateBankrollConfigurationInput } from "./types";

export function useBankrollConfigurations() {
  return useQuery({
    queryKey: ["bankroll-configurations"],
    queryFn: () => apiGet<{ items: BankrollConfiguration[] }>("/api/bankroll-configurations"),
  });
}

export function useCreateBankrollConfiguration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBankrollConfigurationInput) =>
      apiPost<BankrollConfiguration>("/api/bankroll-configurations", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bankroll-configurations"] });
    },
  });
}

export function useDeleteBankrollConfiguration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/bankroll-configurations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bankroll-configurations"] });
    },
  });
}

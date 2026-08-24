import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "./http";
import {
  BankrollLedger,
  BankrollLedgerDetail,
  BankrollLedgerEntry,
  BankrollLedgerSummary,
  CreateBankrollLedgerEntryInput,
  CreateBankrollLedgerInput,
  UpdateBankrollLedgerEntryInput,
  UpdateBankrollLedgerInput,
} from "./types";

export function useBankrollLedgers() {
  return useQuery({
    queryKey: ["bankroll-ledgers"],
    queryFn: () => apiGet<{ items: BankrollLedgerSummary[] }>("/api/bankroll-ledgers"),
  });
}

export function useBankrollLedger(id: string | undefined) {
  return useQuery({
    queryKey: ["bankroll-ledgers", id],
    queryFn: () => apiGet<BankrollLedgerDetail>(`/api/bankroll-ledgers/${id}`),
    enabled: !!id,
  });
}

export function useCreateBankrollLedger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBankrollLedgerInput) => apiPost<BankrollLedger>("/api/bankroll-ledgers", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bankroll-ledgers"] });
    },
  });
}

export function useUpdateBankrollLedger(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBankrollLedgerInput) => apiPatch<BankrollLedger>(`/api/bankroll-ledgers/${id}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bankroll-ledgers"] });
      queryClient.invalidateQueries({ queryKey: ["bankroll-ledgers", id] });
    },
  });
}

export function useDeleteBankrollLedger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/bankroll-ledgers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bankroll-ledgers"] });
    },
  });
}

export function useCreateLedgerEntry(ledgerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBankrollLedgerEntryInput) =>
      apiPost<BankrollLedgerEntry>(`/api/bankroll-ledgers/${ledgerId}/entries`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bankroll-ledgers", ledgerId] });
      queryClient.invalidateQueries({ queryKey: ["bankroll-ledgers"] });
    },
  });
}

export function useUpdateLedgerEntry(ledgerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, input }: { entryId: string; input: UpdateBankrollLedgerEntryInput }) =>
      apiPatch<BankrollLedgerEntry>(`/api/bankroll-ledgers/${ledgerId}/entries/${entryId}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bankroll-ledgers", ledgerId] });
      queryClient.invalidateQueries({ queryKey: ["bankroll-ledgers"] });
    },
  });
}

export function useDeleteLedgerEntry(ledgerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => apiDelete(`/api/bankroll-ledgers/${ledgerId}/entries/${entryId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bankroll-ledgers", ledgerId] });
      queryClient.invalidateQueries({ queryKey: ["bankroll-ledgers"] });
    },
  });
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useUpdateBankrollLedger } from "@/lib/api-client/bankroll-ledgers";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Pencil } from "lucide-react";

/**
 * Botão de lápis que abre um diálogo pra dar/editar o nome do gerenciamento
 * de banca — mesmo padrão de `RenameBacktestDialog`.
 */
export function RenameBankrollLedgerDialog({ ledgerId, currentName }: { ledgerId: string; currentName: string | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName ?? "");
  const updateLedger = useUpdateBankrollLedger(ledgerId);

  function handleOpenChange(next: boolean) {
    if (next) setName(currentName ?? "");
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    updateLedger.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          toast.success("Nome atualizado.");
          setOpen(false);
        },
        onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao atualizar."),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Renomear gerenciamento" />}>
        <Pencil className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nomear gerenciamento</DialogTitle>
          <DialogDescription>Um nome ajuda a identificar o gerenciamento na lista depois.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Field>
            <FieldLabel htmlFor="ledgerName">Nome</FieldLabel>
            <Input
              id="ledgerName"
              autoFocus
              maxLength={60}
              placeholder="Ex: EUR/USD manhã — gerenciamento real"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={updateLedger.isPending || name.trim().length === 0}>
              {updateLedger.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

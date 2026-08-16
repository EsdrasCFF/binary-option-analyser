"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRenameBacktest } from "@/lib/api-client/backtests";
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
 * Botão de lápis que abre um diálogo pra dar/editar o nome do backtest —
 * campo opcional (não é pedido na criação, dá pra nomear a qualquer momento
 * depois pela lista ou pela tela de detalhe).
 */
export function RenameBacktestDialog({ backtestId, currentName }: { backtestId: string; currentName: string | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName ?? "");
  const renameBacktest = useRenameBacktest();

  function handleOpenChange(next: boolean) {
    if (next) setName(currentName ?? "");
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    renameBacktest.mutate(
      { id: backtestId, name: trimmed },
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
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Renomear backtest" />}>
        <Pencil className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nomear backtest</DialogTitle>
          <DialogDescription>Um nome ajuda a identificar o backtest na lista depois.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Field>
            <FieldLabel htmlFor="backtestName">Nome</FieldLabel>
            <Input
              id="backtestName"
              autoFocus
              maxLength={60}
              placeholder="Ex: EUR/USD 5m — contrário"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={renameBacktest.isPending || name.trim().length === 0}>
              {renameBacktest.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

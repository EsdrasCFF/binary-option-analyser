"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRenameBacktestPlus } from "@/lib/api-client/backtest-plus";
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

/** Mesmo componente de `RenameBacktestDialog`, adaptado pro Backtest Plus. */
export function RenameBacktestPlusDialog({ backtestId, currentName }: { backtestId: string; currentName: string | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName ?? "");
  const renameBacktestPlus = useRenameBacktestPlus();

  function handleOpenChange(next: boolean) {
    if (next) setName(currentName ?? "");
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    renameBacktestPlus.mutate(
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
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Renomear Backtest Plus" />}>
        <Pencil className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nomear Backtest Plus</DialogTitle>
          <DialogDescription>Um nome ajuda a identificar o Backtest Plus na lista depois.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Field>
            <FieldLabel htmlFor="backtestPlusName">Nome</FieldLabel>
            <Input
              id="backtestPlusName"
              autoFocus
              maxLength={60}
              placeholder="Ex: Pool EUR/USD + GBP/USD"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={renameBacktestPlus.isPending || name.trim().length === 0}>
              {renameBacktestPlus.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

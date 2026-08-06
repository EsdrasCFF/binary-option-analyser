"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  useBankrollConfigurations,
  useCreateBankrollConfiguration,
  useDeleteBankrollConfiguration,
} from "@/lib/api-client/bankroll-configurations";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";

export default function BankrollConfigurationsPage() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [bankroll, setBankroll] = useState("1000");
  const [payoutPct, setPayoutPct] = useState("85");
  const [maxExposurePct, setMaxExposurePct] = useState("");

  const configs = useBankrollConfigurations();
  const createConfig = useCreateBankrollConfiguration();
  const deleteConfig = useDeleteBankrollConfiguration();

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createConfig.mutate(
      { name, bankroll, payoutPct, maxExposurePct: maxExposurePct || undefined },
      {
        onSuccess: () => {
          toast.success("Configuração salva.");
          setOpen(false);
          setName("");
        },
        onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao salvar."),
      }
    );
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Remover a configuração "${name}"?`)) return;
    deleteConfig.mutate(id, {
      onSuccess: () => toast.success("Removida."),
      onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao remover."),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Configurações de banca</h1>
          <p className="text-muted-foreground">
            Presets de banca/payout reaproveitáveis na Calculadora de Entradas.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>
            <Plus />
            Nova configuração
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova configuração de banca</DialogTitle>
              <DialogDescription>Salve um preset para reutilizar depois.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="name">Nome</FieldLabel>
                  <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="bankroll">Banca</FieldLabel>
                    <Input
                      id="bankroll"
                      type="number"
                      step="0.01"
                      required
                      value={bankroll}
                      onChange={(e) => setBankroll(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="payoutPct">Payout (%)</FieldLabel>
                    <Input
                      id="payoutPct"
                      type="number"
                      step="0.1"
                      required
                      value={payoutPct}
                      onChange={(e) => setPayoutPct(e.target.value)}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="maxExposurePct">Exposição máxima (% opcional)</FieldLabel>
                  <Input
                    id="maxExposurePct"
                    type="number"
                    step="0.1"
                    value={maxExposurePct}
                    onChange={(e) => setMaxExposurePct(e.target.value)}
                  />
                </Field>
              </FieldGroup>
              <DialogFooter className="mt-4">
                <Button type="submit" disabled={createConfig.isPending}>
                  {createConfig.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {configs.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : configs.data?.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma configuração salva ainda.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="text-right">Banca</TableHead>
              <TableHead className="text-right">Payout</TableHead>
              <TableHead className="text-right">Exposição máx.</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {configs.data?.items.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-right">{formatCurrency(c.bankroll)}</TableCell>
                <TableCell className="text-right">{formatPercent(c.payoutPct)}</TableCell>
                <TableCell className="text-right">
                  {c.maxExposurePct ? formatPercent(c.maxExposurePct) : "—"}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(c.id, c.name)}
                    aria-label="Remover"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

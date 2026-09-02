"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useBankrollLedgers, useDeleteBankrollLedger } from "@/lib/api-client/bankroll-ledgers";
import { ApiClientError } from "@/lib/api-client/http";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RenameBankrollLedgerDialog } from "@/components/rename-bankroll-ledger-dialog";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { Trash2 } from "lucide-react";

export default function BankrollLedgersPage() {
  const ledgers = useBankrollLedgers();
  const deleteLedger = useDeleteBankrollLedger();

  function handleDelete(id: string) {
    if (!confirm("Remover este gerenciamento? As operações lançadas também serão removidas.")) return;
    deleteLedger.mutate(id, {
      onSuccess: () => toast.success("Gerenciamento removido."),
      onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao remover."),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gerenciamentos de banca</h1>
        <p className="text-muted-foreground">
          Planilhas manuais de operações, criadas a partir dos horários selecionados numa análise.
        </p>
      </div>

      {ledgers.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : ledgers.data?.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum gerenciamento ainda — crie um a partir do botão &quot;Aplicar gerenciamento&quot; na tela de uma
          análise.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Análise de origem</TableHead>
              <TableHead className="text-right">Operações</TableHead>
              <TableHead className="text-right">Saldo atual</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledgers.data?.items.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Link href={`/bankroll-ledgers/${l.id}`} className="font-medium underline-offset-4 hover:underline">
                      {l.name ?? <span className="text-muted-foreground italic">Sem nome</span>}
                    </Link>
                    <RenameBankrollLedgerDialog ledgerId={l.id} currentName={l.name} />
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    {l.analysisName}
                    {l.analysisType === "plus" && (
                      <Badge variant="secondary" className="text-[10px]">
                        Plus
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right">{l.totalOperations}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(l.currentBalance)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(l.createdAt)}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(l.id)}
                    aria-label="Remover gerenciamento"
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

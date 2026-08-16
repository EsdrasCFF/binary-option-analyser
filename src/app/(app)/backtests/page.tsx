"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useBacktests, useDeleteBacktest } from "@/lib/api-client/backtests";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RenameBacktestDialog } from "@/components/rename-backtest-dialog";
import { formatCurrency, formatDateTime, formatStatus } from "@/lib/format";
import { Trash2 } from "lucide-react";

export default function BacktestsPage() {
  const backtests = useBacktests();
  const deleteBacktest = useDeleteBacktest();

  function handleDelete(id: string) {
    if (!confirm("Remover este backtest? As operações simuladas também serão removidas.")) return;
    deleteBacktest.mutate(id, {
      onSuccess: () => toast.success("Backtest removido."),
      onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao remover."),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backtests</h1>
          <p className="text-muted-foreground">Simulações cronológicas com Martingale.</p>
        </div>
        <Button nativeButton={false} render={<Link href="/backtests/new" />}>
          Novo backtest
        </Button>
      </div>

      {backtests.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : backtests.data?.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum backtest ainda.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Operações</TableHead>
              <TableHead className="text-right">Banca final</TableHead>
              <TableHead className="text-right">Drawdown máx.</TableHead>
              <TableHead className="text-right">Profit factor</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {backtests.data?.items.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Link href={`/backtests/${b.id}`} className="font-medium underline-offset-4 hover:underline">
                      {b.name ?? <span className="text-muted-foreground italic">Sem nome</span>}
                    </Link>
                    <RenameBacktestDialog backtestId={b.id} currentName={b.name} />
                  </div>
                </TableCell>
                <TableCell>
                  <Link href={`/backtests/${b.id}`} className="underline-offset-4 hover:underline">
                    <Badge variant={b.status === "error" ? "destructive" : "secondary"}>
                      {formatStatus(b.status)}
                    </Badge>
                  </Link>
                </TableCell>
                <TableCell className="text-right">{b.totalOperations ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(b.finalBankroll)}</TableCell>
                <TableCell className="text-right">{formatCurrency(b.maxDrawdown)}</TableCell>
                <TableCell className="text-right">{b.profitFactor ? Number(b.profitFactor).toFixed(2) : "—"}</TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(b.createdAt)}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(b.id)}
                    aria-label="Remover backtest"
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

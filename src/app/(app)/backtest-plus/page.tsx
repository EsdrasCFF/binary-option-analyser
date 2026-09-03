"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useBacktestPlusList, useDeleteBacktestPlus } from "@/lib/api-client/backtest-plus";
import { BACKTEST_PLUS_MODEL_LABELS } from "@/lib/api-client/types";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RenameBacktestPlusDialog } from "@/components/rename-backtest-plus-dialog";
import { formatDateTime, formatStatus } from "@/lib/format";
import { Trash2 } from "lucide-react";

export default function BacktestPlusListPage() {
  const backtestPlusList = useBacktestPlusList();
  const deleteBacktestPlus = useDeleteBacktestPlus();

  function handleDelete(id: string) {
    if (!confirm("Remover este Backtest Plus? O pool de candidatos e os resultados dos 5 modelos também serão removidos.")) return;
    deleteBacktestPlus.mutate(id, {
      onSuccess: () => toast.success("Backtest Plus removido."),
      onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao remover."),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Backtest Plus</h1>
        <p className="text-muted-foreground">
          Avalia 5 modelos de seleção sobre o resultado congelado de uma Análise Plus, contra dias futuros
          reais — foco em minimizar dias 0/N, não em maximizar vitórias totais. Criado a partir de uma
          Análise Plus concluída.
        </p>
      </div>

      {backtestPlusList.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : backtestPlusList.data?.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum Backtest Plus ainda — abra uma Análise Plus concluída e clique em &quot;Criar Backtest
          Plus&quot;.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Análise de origem</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Dias testados</TableHead>
              <TableHead>Melhor modelo</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {backtestPlusList.data?.items.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Link href={`/backtest-plus/${b.id}`} className="font-medium underline-offset-4 hover:underline">
                      {b.name ?? <span className="text-muted-foreground italic">Sem nome</span>}
                    </Link>
                    <RenameBacktestPlusDialog backtestId={b.id} currentName={b.name} />
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{b.sourceAnalysisName}</TableCell>
                <TableCell>
                  <Link href={`/backtest-plus/${b.id}`} className="underline-offset-4 hover:underline">
                    <Badge variant={b.status === "error" ? "destructive" : "secondary"}>{formatStatus(b.status)}</Badge>
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  {b.daysTested ?? "—"}/{b.forwardDaysRequested}
                </TableCell>
                <TableCell>{b.bestModel ? BACKTEST_PLUS_MODEL_LABELS[b.bestModel] : "—"}</TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(b.createdAt)}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(b.id)}
                    aria-label="Remover Backtest Plus"
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

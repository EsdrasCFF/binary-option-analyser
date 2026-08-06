"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useAnalyses, useDeleteAnalysis } from "@/lib/api-client/analyses";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatStatus } from "@/lib/format";
import { Trash2 } from "lucide-react";

export default function AnalysesPage() {
  const analyses = useAnalyses();
  const deleteAnalysis = useDeleteAnalysis();

  function handleDelete(id: string, name: string) {
    if (!confirm(`Remover a análise "${name}"? Os padrões encontrados também serão removidos.`)) return;
    deleteAnalysis.mutate(id, {
      onSuccess: () => toast.success("Análise removida."),
      onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao remover."),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Análises</h1>
          <p className="text-muted-foreground">Descobertas de padrão por horário.</p>
        </div>
        <Button nativeButton={false} render={<Link href="/analyses/new" />}>
          Nova análise
        </Button>
      </div>

      {analyses.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : analyses.data?.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma análise ainda.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Criada em</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {analyses.data?.items.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link href={`/analyses/${a.id}`} className="font-medium underline-offset-4 hover:underline">
                    {a.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={a.status === "error" ? "destructive" : "secondary"}>
                    {formatStatus(a.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(a.createdAt)}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(a.id, a.name)}
                    aria-label="Remover análise"
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

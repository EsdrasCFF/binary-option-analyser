"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAnalyses } from "@/lib/api-client/analyses";
import { useMultiPeriodAnalyses } from "@/lib/api-client/multi-period-analyses";
import { useUpdateBankrollLedger } from "@/lib/api-client/bankroll-ledgers";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Link2 } from "lucide-react";

/**
 * Diálogo aberto a partir de um gerenciamento, pra trocar a análise vinculada
 * a ele — de período único OU Análise Plus, inclusive trocando de um tipo
 * pro outro. Os horários disponíveis passam a ser os da análise escolhida
 * (todos, numa análise de período único; só o TOP 20 por Confidence Score,
 * numa Análise Plus), mas as linhas já lançadas continuam intactas.
 */
export function LinkAnalysisDialog({
  ledgerId,
  currentAnalysisId,
  currentMultiPeriodAnalysisId,
}: {
  ledgerId: string;
  currentAnalysisId: string | null;
  currentMultiPeriodAnalysisId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const analyses = useAnalyses();
  const multiPeriodAnalyses = useMultiPeriodAnalyses();
  const updateLedger = useUpdateBankrollLedger(ledgerId);

  function handleSelect(input: { analysisId: string } | { multiPeriodAnalysisId: string }) {
    const isCurrent =
      "analysisId" in input ? input.analysisId === currentAnalysisId : input.multiPeriodAnalysisId === currentMultiPeriodAnalysisId;
    if (isCurrent) {
      setOpen(false);
      return;
    }
    updateLedger.mutate(input, {
      onSuccess: () => {
        toast.success("Análise vinculada atualizada.");
        setOpen(false);
      },
      onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao vincular."),
    });
  }

  const isLoading = analyses.isLoading || multiPeriodAnalyses.isLoading;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" />}>
        <Link2 className="size-3.5" />
        Trocar análise
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trocar a análise vinculada</DialogTitle>
          <DialogDescription>
            Os horários disponíveis nas linhas passam a ser os da análise escolhida (todos, numa análise de período
            único; o TOP 20 por Confidence Score, numa Análise Plus). As operações já lançadas não são afetadas.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
            {(multiPeriodAnalyses.data?.items.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1">
                <p className="px-2 text-xs font-medium text-muted-foreground uppercase">Análises Plus</p>
                {multiPeriodAnalyses.data?.items.map((a) => (
                  <Button
                    key={a.id}
                    variant={a.id === currentMultiPeriodAnalysisId ? "secondary" : "ghost"}
                    className="h-auto justify-start py-2"
                    disabled={updateLedger.isPending}
                    onClick={() => handleSelect({ multiPeriodAnalysisId: a.id })}
                  >
                    <div className="flex flex-col items-start">
                      <span className="flex items-center gap-1.5 font-medium">
                        {a.name}
                        <Badge variant="secondary" className="text-[10px]">
                          Plus
                        </Badge>
                      </span>
                      {a.id === currentMultiPeriodAnalysisId && (
                        <span className="text-xs text-muted-foreground">Vinculada atualmente</span>
                      )}
                    </div>
                  </Button>
                ))}
              </div>
            )}

            {(analyses.data?.items.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1">
                <p className="px-2 text-xs font-medium text-muted-foreground uppercase">Análises</p>
                {analyses.data?.items.map((a) => (
                  <Button
                    key={a.id}
                    variant={a.id === currentAnalysisId ? "secondary" : "ghost"}
                    className="h-auto justify-start py-2"
                    disabled={updateLedger.isPending}
                    onClick={() => handleSelect({ analysisId: a.id })}
                  >
                    <div className="flex flex-col items-start">
                      <span className="font-medium">{a.name}</span>
                      {a.id === currentAnalysisId && <span className="text-xs text-muted-foreground">Vinculada atualmente</span>}
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

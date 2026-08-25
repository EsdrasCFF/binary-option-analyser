"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAnalyses } from "@/lib/api-client/analyses";
import { useUpdateBankrollLedger } from "@/lib/api-client/bankroll-ledgers";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
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
 * a ele — os horários disponíveis passam a ser os da análise escolhida, mas
 * as linhas já lançadas continuam intactas (cada uma guarda seu próprio
 * patternResultId).
 */
export function LinkAnalysisDialog({ ledgerId, currentAnalysisId }: { ledgerId: string; currentAnalysisId: string }) {
  const [open, setOpen] = useState(false);
  const analyses = useAnalyses();
  const updateLedger = useUpdateBankrollLedger(ledgerId);

  function handleSelect(analysisId: string) {
    if (analysisId === currentAnalysisId) {
      setOpen(false);
      return;
    }
    updateLedger.mutate(
      { analysisId },
      {
        onSuccess: () => {
          toast.success("Análise vinculada atualizada.");
          setOpen(false);
        },
        onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao vincular."),
      }
    );
  }

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
            Os horários disponíveis nas linhas passam a ser os da análise escolhida. As operações já lançadas não são
            afetadas.
          </DialogDescription>
        </DialogHeader>

        {analyses.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="flex flex-col gap-1">
            {analyses.data?.items.map((a) => (
              <Button
                key={a.id}
                variant={a.id === currentAnalysisId ? "secondary" : "ghost"}
                className="h-auto justify-start py-2"
                disabled={updateLedger.isPending}
                onClick={() => handleSelect(a.id)}
              >
                <div className="flex flex-col items-start">
                  <span className="font-medium">{a.name}</span>
                  {a.id === currentAnalysisId && <span className="text-xs text-muted-foreground">Vinculada atualmente</span>}
                </div>
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

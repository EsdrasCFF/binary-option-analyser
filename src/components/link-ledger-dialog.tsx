"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useBankrollLedgers, useUpdateBankrollLedger } from "@/lib/api-client/bankroll-ledgers";
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
 * Diálogo aberto a partir de uma análise (de período único OU Plus), pra
 * vincular (ou trocar a vinculação de) um gerenciamento de banca JÁ
 * EXISTENTE a esta análise — os horários disponíveis nele passam a ser os
 * desta análise, mas as linhas já lançadas continuam intactas.
 */
export function LinkLedgerDialog({
  sourceAnalysisId,
  sourceType,
}: {
  sourceAnalysisId: string;
  sourceType: "single" | "plus";
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const ledgers = useBankrollLedgers();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Link2 className="size-4" />
        Vincular a gerenciamento existente
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular a um gerenciamento existente</DialogTitle>
          <DialogDescription>
            Os horários desta análise passam a ficar disponíveis nesse gerenciamento. As operações já lançadas nele
            não são apagadas.
          </DialogDescription>
        </DialogHeader>

        {ledgers.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : ledgers.data?.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Você ainda não tem nenhum gerenciamento criado.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {ledgers.data?.items.map((l) => (
              <LedgerOption
                key={l.id}
                ledgerId={l.id}
                name={l.name}
                analysisName={l.analysisName}
                analysisType={l.analysisType}
                sourceAnalysisId={sourceAnalysisId}
                sourceType={sourceType}
                onLinked={() => {
                  setOpen(false);
                  router.push(`/bankroll-ledgers/${l.id}`);
                }}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LedgerOption({
  ledgerId,
  name,
  analysisName,
  analysisType,
  sourceAnalysisId,
  sourceType,
  onLinked,
}: {
  ledgerId: string;
  name: string | null;
  analysisName: string;
  analysisType: "single" | "plus";
  sourceAnalysisId: string;
  sourceType: "single" | "plus";
  onLinked: () => void;
}) {
  const updateLedger = useUpdateBankrollLedger(ledgerId);

  function handleClick() {
    updateLedger.mutate(
      sourceType === "plus" ? { multiPeriodAnalysisId: sourceAnalysisId } : { analysisId: sourceAnalysisId },
      {
        onSuccess: () => {
          toast.success("Gerenciamento vinculado a esta análise.");
          onLinked();
        },
        onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao vincular."),
      }
    );
  }

  return (
    <Button
      variant="ghost"
      className="h-auto justify-start py-2"
      disabled={updateLedger.isPending}
      onClick={handleClick}
    >
      <div className="flex flex-col items-start">
        <span className="flex items-center gap-1.5 font-medium">
          {name ?? "Sem nome"}
          {analysisType === "plus" && (
            <Badge variant="secondary" className="text-[10px]">
              Plus
            </Badge>
          )}
        </span>
        <span className="text-xs text-muted-foreground">Atualmente: {analysisName}</span>
      </div>
    </Button>
  );
}

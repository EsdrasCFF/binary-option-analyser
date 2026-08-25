"use client";

import { use } from "react";
import { toast } from "sonner";
import {
  useBankrollLedger,
  useCreateLedgerEntry,
  useDeleteLedgerEntry,
  useUpdateLedgerEntry,
} from "@/lib/api-client/bankroll-ledgers";
import { ApiClientError } from "@/lib/api-client/http";
import { BankrollLedgerEntry, BankrollLedgerSlot, UpdateBankrollLedgerEntryInput } from "@/lib/api-client/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RenameBankrollLedgerDialog } from "@/components/rename-bankroll-ledger-dialog";
import { LinkAnalysisDialog } from "@/components/link-analysis-dialog";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

const RESULT_LABELS = { win: "Vitória", loss: "Derrota", tie: "Empate" } as const;

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

/** yyyy-MM-dd direto dos 10 primeiros caracteres do ISO — o valor já é uma
 * data pura (meia-noite UTC), então NÃO passa por conversão de fuso alguma
 * (mesmo cuidado que já foi necessário no resto do app: converter pro fuso
 * do navegador aqui reintroduziria o bug de "dia errado"). */
function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

function LedgerRow({
  entry,
  availableSlots,
  onUpdate,
  onDelete,
  isDeleting,
}: {
  entry: BankrollLedgerEntry;
  availableSlots: BankrollLedgerSlot[];
  onUpdate: (entryId: string, input: UpdateBankrollLedgerEntryInput) => void;
  onDelete: (entryId: string) => void;
  isDeleting: boolean;
}) {
  const [date, setDate] = useState(toDateInputValue(entry.date));
  const [payoutPct, setPayoutPct] = useState(entry.payoutPct);
  const [entryValue, setEntryValue] = useState(entry.entryValue);

  // a linha pode ter sido lançada com um horário de uma análise que já não é
  // mais a vinculada (o ledger pode ter sido re-vinculado depois) — nesse
  // caso o horário não está em `availableSlots`, então incluímos a própria
  // opção da linha na lista pra o select continuar mostrando o rótulo certo.
  const slotOptions = availableSlots.some((s) => s.id === entry.patternResultId)
    ? availableSlots
    : [
        {
          id: entry.patternResultId,
          symbol: entry.symbol,
          timeOfDay: entry.timeOfDay,
          predominantDirection: entry.predominantDirection,
        },
        ...availableSlots,
      ];

  return (
    <TableRow>
      <TableCell>
        <Input
          type="date"
          className="w-36"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onBlur={() => {
            if (date) onUpdate(entry.id, { date: new Date(`${date}T00:00:00Z`).toISOString() });
          }}
        />
      </TableCell>
      <TableCell>
        <Select<string>
          items={Object.fromEntries(slotOptions.map((s) => [s.id, `${s.symbol} ${s.timeOfDay}`]))}
          value={entry.patternResultId}
          onValueChange={(v) => v && onUpdate(entry.id, { patternResultId: v })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {slotOptions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.symbol} {s.timeOfDay}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {entry.predominantDirection ? (
          <Badge variant={entry.predominantDirection === "CALL" ? "default" : "secondary"}>
            {entry.predominantDirection}
          </Badge>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.1"
          min={0}
          max={100}
          className="w-20"
          value={payoutPct}
          onChange={(e) => setPayoutPct(e.target.value)}
          onBlur={() => payoutPct && onUpdate(entry.id, { payoutPct })}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.01"
          min={0.01}
          className="w-24"
          value={entryValue}
          onChange={(e) => setEntryValue(e.target.value)}
          onBlur={() => entryValue && onUpdate(entry.id, { entryValue })}
        />
      </TableCell>
      <TableCell>
        <Select<string>
          items={RESULT_LABELS}
          value={entry.result}
          onValueChange={(v) => v && onUpdate(entry.id, { result: v as "win" | "loss" | "tie" })}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="win">Vitória</SelectItem>
            <SelectItem value="loss">Derrota</SelectItem>
            <SelectItem value="tie">Empate</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className={`text-right font-medium ${Number(entry.profitLoss) < 0 ? "text-destructive" : ""}`}>
        {formatCurrency(entry.profitLoss)}
      </TableCell>
      <TableCell className="text-right">{formatCurrency(entry.bankrollAfter)}</TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isDeleting}
          onClick={() => onDelete(entry.id)}
          aria-label="Remover operação"
        >
          <Trash2 className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function BankrollLedgerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ledger = useBankrollLedger(id);
  const createEntry = useCreateLedgerEntry(id);
  const updateEntry = useUpdateLedgerEntry(id);
  const deleteEntry = useDeleteLedgerEntry(id);

  if (ledger.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!ledger.data) return <p className="text-sm text-destructive">Gerenciamento não encontrado.</p>;

  const { ledger: l, analysisName, availableSlots, entries, totals } = ledger.data;
  const resultTotal = Number(totals.currentBalance) - Number(l.initialBankroll);

  function handleAddEntry() {
    if (availableSlots.length === 0) return;
    const today = new Date();
    const todayIso = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())).toISOString();
    createEntry.mutate(
      {
        patternResultId: availableSlots[0].id,
        date: todayIso,
        payoutPct: "85",
        entryValue: "5",
        result: "win",
      },
      {
        onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao adicionar operação."),
      }
    );
  }

  function handleUpdateEntry(entryId: string, input: UpdateBankrollLedgerEntryInput) {
    updateEntry.mutate(
      { entryId, input },
      {
        onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao salvar."),
      }
    );
  }

  function handleDeleteEntry(entryId: string) {
    if (!confirm("Remover esta operação?")) return;
    deleteEntry.mutate(entryId, {
      onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao remover."),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {l.name ?? <span className="text-muted-foreground italic">Gerenciamento sem nome</span>}
            </h1>
            <RenameBankrollLedgerDialog ledgerId={l.id} currentName={l.name} />
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <p>
              Análise: {analysisName} · Criado em {formatDateTime(l.createdAt)}
            </p>
            <LinkAnalysisDialog ledgerId={l.id} currentAnalysisId={l.analysisId} />
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-6 pt-6 sm:grid-cols-3 lg:grid-cols-7">
          <StatBox label="Banca inicial" value={formatCurrency(l.initialBankroll)} />
          <StatBox label="Saldo atual" value={formatCurrency(totals.currentBalance)} />
          <StatBox label="Resultado total" value={formatCurrency(resultTotal)} />
          <StatBox label="Operações" value={String(totals.totalOperations)} />
          <StatBox label="Vitórias" value={String(totals.wins)} />
          <StatBox label="Derrotas" value={String(totals.losses)} />
          <StatBox label="Empates" value={String(totals.ties)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planilha de operações</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {availableSlots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum horário disponível — a análise de origem pode ter sido alterada.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Horário</TableHead>
                    <TableHead>Direção sugerida</TableHead>
                    <TableHead>%</TableHead>
                    <TableHead>Entrada</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead className="text-right">Resultado financeiro</TableHead>
                    <TableHead className="text-right">Saldo acumulado</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <LedgerRow
                      key={entry.id}
                      entry={entry}
                      availableSlots={availableSlots}
                      onUpdate={handleUpdateEntry}
                      onDelete={handleDeleteEntry}
                      isDeleting={deleteEntry.isPending}
                    />
                  ))}
                </TableBody>
              </Table>
              {entries.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhuma operação lançada ainda.</p>
              )}
              <Button variant="outline" size="sm" onClick={handleAddEntry} disabled={createEntry.isPending}>
                <Plus className="size-4" />
                Adicionar operação
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

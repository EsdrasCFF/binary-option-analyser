"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useMultiPeriodAnalysis, useMultiPeriodPatternResults } from "@/lib/api-client/multi-period-analyses";
import { useCreateBacktestPlus } from "@/lib/api-client/backtest-plus";
import { ApiClientError } from "@/lib/api-client/http";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatPercent } from "@/lib/format";
import { AlertTriangle } from "lucide-react";

const POOL_SIZE = 10;

export default function NewBacktestPlusPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sourceAnalysisId = searchParams.get("sourceAnalysisId") ?? undefined;

  const analysis = useMultiPeriodAnalysis(sourceAnalysisId);
  const patternResults = useMultiPeriodPatternResults({
    analysisId: sourceAnalysisId,
    sortBy: "confidenceScore",
    order: "desc",
    limit: 200,
  });

  // ordem de seleção é preservada (não é um Set desordenado) — ela vira o
  // poolRank, usado como desempate determinístico pelos 5 modelos.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [entriesPerDay, setEntriesPerDay] = useState<"4" | "5">("5");
  const [forwardDaysRequested, setForwardDaysRequested] = useState("3");

  const createBacktestPlus = useCreateBacktestPlus();

  function toggle(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= POOL_SIZE) return prev; // pool já completo — ignora novas marcações
      return [...prev, id];
    });
  }

  function onSubmit() {
    if (!sourceAnalysisId) return;
    if (selectedIds.length !== POOL_SIZE) {
      toast.error(`Selecione exatamente ${POOL_SIZE} candidatos (${selectedIds.length}/${POOL_SIZE}).`);
      return;
    }
    const days = Number(forwardDaysRequested);
    if (!Number.isInteger(days) || days < 1 || days > 5) {
      toast.error("Dias futuros deve ser um número entre 1 e 5.");
      return;
    }

    createBacktestPlus.mutate(
      {
        name: name.trim() || undefined,
        sourceAnalysisId,
        candidateIds: selectedIds,
        entriesPerDay: entriesPerDay === "4" ? 4 : 5,
        forwardDaysRequested: days,
      },
      {
        onSuccess: (result) => {
          if (result.backtestPlus.status === "error") {
            toast.error(result.backtestPlus.errorMessage ?? "Falha ao processar o Backtest Plus.");
          } else {
            toast.success(
              result.processed
                ? `Backtest Plus concluído — ${result.daysTested ?? 0} dia(s) testado(s).`
                : "Backtest Plus criado."
            );
          }
          router.push(`/backtest-plus/${result.backtestPlus.id}`);
        },
        onError: (err) => {
          toast.error(err instanceof ApiClientError ? err.message : "Falha ao criar Backtest Plus.");
        },
      }
    );
  }

  if (!sourceAnalysisId) {
    return (
      <div className="max-w-2xl">
        <Alert>
          <AlertTriangle />
          <AlertTitle>Nenhuma Análise Plus informada</AlertTitle>
          <AlertDescription>
            Abra uma{" "}
            <Link href="/analyses-plus" className="underline underline-offset-4">
              Análise Plus concluída
            </Link>{" "}
            e clique em &quot;Criar Backtest Plus&quot;.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo Backtest Plus</h1>
        <p className="text-muted-foreground">
          Avalia 5 modelos de seleção sobre o resultado já congelado desta Análise Plus, contra dias futuros
          reais — o objetivo é minimizar dias 0/N (todas as entradas do dia perdedoras), não maximizar
          vitórias totais.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Pool de candidatos ({selectedIds.length}/{POOL_SIZE})
          </CardTitle>
          <CardDescription>
            Selecione exatamente {POOL_SIZE} padrões desta análise — a ordem de seleção é preservada como
            desempate determinístico entre os modelos. O estado (score, direção, classificação) fica
            congelado exatamente como está aqui, mesmo que a análise seja reprocessada depois.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {patternResults.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : patternResults.data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum padrão encontrado nesta análise.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6" />
                  <TableHead>Par</TableHead>
                  <TableHead>Horário</TableHead>
                  <TableHead>Direção</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Média estrutural</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patternResults.data?.items.map((item) => {
                  const checked = selectedIds.includes(item.id);
                  const disabled = !checked && selectedIds.length >= POOL_SIZE;
                  return (
                    <TableRow
                      key={item.id}
                      className={disabled ? "opacity-50" : "cursor-pointer"}
                      onClick={() => !disabled && toggle(item.id)}
                    >
                      <TableCell>
                        <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggle(item.id)} />
                      </TableCell>
                      <TableCell className="font-medium">{item.symbol}</TableCell>
                      <TableCell>{item.timeOfDay}</TableCell>
                      <TableCell>
                        <Badge variant={item.direction === "CALL" ? "default" : "secondary"}>{item.direction}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{item.confidenceScore}</TableCell>
                      <TableCell className="text-right">{formatPercent(item.structuralAverage)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuração do teste</CardTitle>
          <CardDescription>
            A cada dia futuro válido (com candle real disponível), cada um dos 5 modelos escolhe N candidatos
            dentro do pool acima — nunca recalcula a análise, só resolve WIN/LOSS/INVALID contra a candle real
            daquele dia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Nome (opcional)</FieldLabel>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="entriesPerDay">Entradas por dia</FieldLabel>
                <Select
                  items={{ "4": "4 entradas", "5": "5 entradas" }}
                  value={entriesPerDay}
                  onValueChange={(v) => v && setEntriesPerDay(v as "4" | "5")}
                >
                  <SelectTrigger id="entriesPerDay" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">4 entradas</SelectItem>
                    <SelectItem value="5">5 entradas</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="forwardDaysRequested">Dias futuros (1-5)</FieldLabel>
                <Input
                  id="forwardDaysRequested"
                  type="number"
                  min={1}
                  max={5}
                  value={forwardDaysRequested}
                  onChange={(e) => setForwardDaysRequested(e.target.value)}
                />
                <FieldDescription>
                  Pode testar menos dias do que o pedido se faltar candle na ponta mais recente — nunca mais.
                </FieldDescription>
              </Field>
            </div>

            <Button onClick={onSubmit} disabled={createBacktestPlus.isPending || analysis.isLoading}>
              {createBacktestPlus.isPending ? "Processando..." : "Criar e executar Backtest Plus"}
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  );
}

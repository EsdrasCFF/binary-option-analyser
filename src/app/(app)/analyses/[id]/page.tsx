"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useAnalysis } from "@/lib/api-client/analyses";
import { usePatternResults } from "@/lib/api-client/pattern-results";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatPercent, formatStatus } from "@/lib/format";

export default function AnalysisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const analysis = useAnalysis(id);
  const patternResults = usePatternResults({ analysisId: id, sortBy: "repetitionPct", order: "desc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(patternId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(patternId)) next.delete(patternId);
      else next.add(patternId);
      return next;
    });
  }

  function createBacktest() {
    const ids = Array.from(selected);
    router.push(`/backtests/new?patternResultIds=${ids.join(",")}`);
  }

  if (analysis.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (!analysis.data) {
    return <p className="text-sm text-destructive">Análise não encontrada.</p>;
  }

  const { analysis: a, configuration } = analysis.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{a.name}</h1>
          <p className="text-muted-foreground">Criada em {formatDateTime(a.createdAt)}</p>
        </div>
        <Badge variant={a.status === "error" ? "destructive" : "secondary"}>{formatStatus(a.status)}</Badge>
      </div>

      {a.status === "error" && a.errorMessage && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{a.errorMessage}</CardContent>
        </Card>
      )}

      <Tabs defaultValue="ranking">
        <TabsList>
          <TabsTrigger value="ranking">Ranking de padrões ({analysis.data.patternResultCount})</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
        </TabsList>

        <TabsContent value="ranking" className="flex flex-col gap-4">
          {selected.size > 0 && (
            <div className="flex items-center justify-between rounded-md border bg-muted/50 p-3">
              <span className="text-sm">{selected.size} padrão(ões) selecionado(s)</span>
              <Button size="sm" onClick={createBacktest}>
                Criar backtest com selecionados
              </Button>
            </div>
          )}

          {patternResults.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : patternResults.data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum padrão encontrado nesta análise.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Par</TableHead>
                  <TableHead>Horário</TableHead>
                  <TableHead>Direção</TableHead>
                  <TableHead className="text-right">Repetição</TableHead>
                  <TableHead className="text-right">Dias válidos</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patternResults.data?.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                    </TableCell>
                    <TableCell className="font-medium">{p.symbol}</TableCell>
                    <TableCell>{p.timeOfDay}</TableCell>
                    <TableCell>
                      <Badge variant={p.predominantDirection === "CALL" ? "default" : "secondary"}>
                        {p.predominantDirection ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatPercent(p.repetitionPct)}</TableCell>
                    <TableCell className="text-right">{p.totalValid}</TableCell>
                    <TableCell className="text-muted-foreground">{formatStatus(p.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="config">
          {configuration && (
            <Card>
              <CardHeader>
                <CardTitle>Parâmetros usados</CardTitle>
                <CardDescription>Não podem ser alterados após a criação.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                <ConfigItem label="Timeframe" value={configuration.timeframe} />
                <ConfigItem label="Dias de histórico" value={String(configuration.historicalDays ?? "—")} />
                <ConfigItem label="Timezone" value={configuration.timezone} />
                <ConfigItem
                  label="Janela de horário"
                  value={
                    configuration.startTime || configuration.endTime
                      ? `${configuration.startTime ?? "00:00"} – ${configuration.endTime ?? "23:59"}`
                      : "Dia todo"
                  }
                />
                <ConfigItem label="% mínimo" value={formatPercent(configuration.minRepetitionPct)} />
                <ConfigItem label="Dias válidos mín." value={String(configuration.minValidDays)} />
                <ConfigItem label="Top N" value={String(configuration.topN)} />
                <ConfigItem
                  label="Estratégia"
                  value={configuration.entryStrategy === "contrarian" ? "Contrária" : "Mesma direção"}
                />
                <ConfigItem label="Política de DOJI" value={formatStatus(configuration.dojiPolicy)} />
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

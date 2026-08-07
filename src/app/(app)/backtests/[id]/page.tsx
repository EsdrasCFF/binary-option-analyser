"use client";

import { use, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useBacktest, useBacktestOperations } from "@/lib/api-client/backtests";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDateTime, formatStatus } from "@/lib/format";
import { GroupStats } from "@/lib/api-client/types";

const WEEKDAY_NAMES: Record<string, string> = {
  "1": "Seg",
  "2": "Ter",
  "3": "Qua",
  "4": "Qui",
  "5": "Sex",
  "6": "Sáb",
  "7": "Dom",
};

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

function GroupChart({ title, data }: { title: string; data: Array<{ key: string; value: number }> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="key" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip
              formatter={(value) => formatCurrency(typeof value === "number" ? value : Number(value))}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.key} className={entry.value < 0 ? "fill-destructive" : "fill-primary"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function toChartData(stats: Record<string, GroupStats> | undefined, labelFor: (key: string) => string) {
  if (!stats) return [];
  return Object.entries(stats)
    .map(([key, s]) => ({ key: labelFor(key), value: Number(s.netProfitLoss) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export default function BacktestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const backtest = useBacktest(id);
  const [resultFilter, setResultFilter] = useState<"win" | "loss" | "tie" | undefined>(undefined);
  const operations = useBacktestOperations(id, { result: resultFilter, limit: 100 });

  if (backtest.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!backtest.data) return <p className="text-sm text-destructive">Backtest não encontrado.</p>;

  const b = backtest.data;
  const summary = b.summary;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backtest</h1>
          <p className="text-muted-foreground">Criado em {formatDateTime(b.createdAt)}</p>
        </div>
        <Badge variant={b.status === "error" ? "destructive" : "secondary"}>{formatStatus(b.status)}</Badge>
      </div>

      {b.status === "error" && b.errorMessage && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{b.errorMessage}</CardContent>
        </Card>
      )}

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Resumo</TabsTrigger>
          <TabsTrigger value="operations">Operações ({b.totalOperations ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="flex flex-col gap-4">
          {summary ? (
            <>
              <Card>
                <CardContent className="grid grid-cols-2 gap-6 pt-6 sm:grid-cols-3 lg:grid-cols-6">
                  <StatBox label="Banca final" value={formatCurrency(summary.finalBankroll)} />
                  <StatBox label="Operações" value={String(summary.totalOperations)} />
                  <StatBox label="Vitórias" value={String(summary.wins)} />
                  <StatBox label="Derrotas" value={String(summary.losses)} />
                  <StatBox label="Drawdown máx." value={formatCurrency(summary.maxDrawdown)} />
                  <StatBox
                    label="Profit factor"
                    value={summary.profitFactor ? Number(summary.profitFactor).toFixed(2) : "—"}
                  />
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <GroupChart title="Resultado por horário" data={toChartData(summary.byTimeOfDay, (k) => k)} />
                <GroupChart
                  title="Resultado por dia da semana"
                  data={toChartData(summary.byWeekday, (k) => WEEKDAY_NAMES[k] ?? k)}
                />
                <GroupChart title="Resultado por par" data={toChartData(summary.bySymbol, (k) => k)} />
                <GroupChart title="Resultado por mês" data={toChartData(summary.byMonth, (k) => k)} />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Backtest ainda não processado.</p>
          )}
        </TabsContent>

        <TabsContent value="operations" className="flex flex-col gap-4">
          <div className="w-48">
            <Select
              items={{ all: "Todos", win: "Vitórias", loss: "Derrotas", tie: "Empates" }}
              value={resultFilter ?? "all"}
              onValueChange={(v) => setResultFilter(v && v !== "all" ? (v as "win" | "loss" | "tie") : undefined)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="win">Vitórias</SelectItem>
                <SelectItem value="loss">Derrotas</SelectItem>
                <SelectItem value="tie">Empates</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {operations.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Par</TableHead>
                  <TableHead>Horário</TableHead>
                  <TableHead>Previsto → Real</TableHead>
                  <TableHead className="text-right">Nível</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                  <TableHead className="text-right">Banca após</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operations.data?.items.map((op) => (
                  <TableRow key={op.id}>
                    <TableCell className="text-muted-foreground">{formatDateTime(op.operationDate)}</TableCell>
                    <TableCell className="font-medium">{op.symbol}</TableCell>
                    <TableCell>{op.timeOfDay}</TableCell>
                    <TableCell>
                      {op.entryDirection} → {op.actualDirection}
                    </TableCell>
                    <TableCell className="text-right">{op.martingaleLevelReached}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          op.result === "win" ? "default" : op.result === "loss" ? "destructive" : "secondary"
                        }
                      >
                        {formatStatus(op.result)}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${Number(op.profitLoss) < 0 ? "text-destructive" : ""}`}
                    >
                      {formatCurrency(op.profitLoss)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(op.bankrollAfter)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

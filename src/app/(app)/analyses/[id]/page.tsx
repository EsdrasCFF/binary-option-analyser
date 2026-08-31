"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useAnalysis } from "@/lib/api-client/analyses";
import { usePatternResults } from "@/lib/api-client/pattern-results";
import { useCurrencyPairs } from "@/lib/api-client/currency-pairs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatDateTime, formatPercent, formatStatus } from "@/lib/format";
import { DayPeriod, PatternResultsQuery } from "@/lib/api-client/types";
import { LinkLedgerDialog } from "@/components/link-ledger-dialog";
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from "lucide-react";

type SortBy = NonNullable<PatternResultsQuery["sortBy"]>;

const DEFAULT_SORT_ORDER: Record<SortBy, "asc" | "desc"> = {
  repetitionPct: "desc",
  totalValid: "desc",
  recent10Pct: "desc",
  timeOfDay: "asc",
  direction: "asc",
};

function SortableHeader({
  label,
  active,
  order,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  order: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {active ? (
          order === "asc" ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )
        ) : (
          <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
        )}
      </button>
    </TableHead>
  );
}

const STATUS_LEGEND: Array<{ status: string; criteria: string }> = [
  { status: "Forte e ativo", criteria: "Repetição geral ≥ 75% e nas últimas 10 ocorrências ≥ 70%." },
  { status: "Ativo", criteria: "Repetição geral ≥ 65% e nas últimas 10 ocorrências ≥ 55%." },
  { status: "Perdendo força", criteria: "Repetição recente (10 ocorrências) caiu 15 pontos ou mais frente à geral." },
  { status: "Inativo", criteria: "Não atende a nenhum dos critérios acima." },
  { status: "Amostra insuficiente", criteria: "Menos ocorrências válidas do que o \"Dias válidos mín.\" configurado." },
];

const DAY_PERIOD_LABELS: Record<DayPeriod, string> = {
  madrugada: "Madrugada (00:00–05:59)",
  manha: "Manhã (06:00–11:59)",
  tarde: "Tarde (12:00–17:59)",
  noite: "Noite (18:00–23:59)",
};

export default function AnalysisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const analysis = useAnalysis(id);
  const currencyPairs = useCurrencyPairs();
  const [period, setPeriod] = useState<DayPeriod | undefined>(undefined);
  const [currencyPairId, setCurrencyPairId] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<SortBy>("repetitionPct");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const patternResults = usePatternResults({ analysisId: id, sortBy, order, period, currencyPairId });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const analysisPairIds = new Set(analysis.data?.configuration?.currencyPairIds ?? []);
  const analysisPairs = (currencyPairs.data?.items ?? []).filter((p) => analysisPairIds.has(p.id));

  function handleSort(column: SortBy) {
    if (sortBy === column) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setOrder(DEFAULT_SORT_ORDER[column]);
    }
  }

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
    router.push(`/backtests/new?patternResultIds=${ids.join(",")}&analysisId=${id}`);
  }

  function applyLedger() {
    router.push(`/bankroll-ledgers/new?analysisId=${id}`);
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{a.name}</h1>
          <p className="text-muted-foreground">Criada em {formatDateTime(a.createdAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={applyLedger}>
            Aplicar gerenciamento
          </Button>
          <LinkLedgerDialog analysisId={id} />
          <Badge variant={a.status === "error" ? "destructive" : "secondary"}>{formatStatus(a.status)}</Badge>
        </div>
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
          <div className="flex flex-wrap gap-2">
            {analysisPairs.length > 1 && (
              <div className="w-full sm:w-56">
                <Select
                  items={{ all: "Todas as divisas", ...Object.fromEntries(analysisPairs.map((p) => [p.id, p.symbol])) }}
                  value={currencyPairId ?? "all"}
                  onValueChange={(v) => setCurrencyPairId(v && v !== "all" ? v : undefined)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as divisas</SelectItem>
                    {analysisPairs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="w-full sm:w-56">
              <Select
                items={{ all: "Todos os horários", ...DAY_PERIOD_LABELS }}
                value={period ?? "all"}
                onValueChange={(v) => setPeriod(v && v !== "all" ? (v as DayPeriod) : undefined)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os horários</SelectItem>
                  {(Object.keys(DAY_PERIOD_LABELS) as DayPeriod[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {DAY_PERIOD_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

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
                  <SortableHeader
                    label="Horário"
                    active={sortBy === "timeOfDay"}
                    order={order}
                    onClick={() => handleSort("timeOfDay")}
                  />
                  <SortableHeader
                    label="Direção"
                    active={sortBy === "direction"}
                    order={order}
                    onClick={() => handleSort("direction")}
                  />
                  <SortableHeader
                    label="Repetição"
                    active={sortBy === "repetitionPct"}
                    order={order}
                    onClick={() => handleSort("repetitionPct")}
                    className="text-right"
                  />
                  <SortableHeader
                    label="Dias válidos"
                    active={sortBy === "totalValid"}
                    order={order}
                    onClick={() => handleSort("totalValid")}
                    className="text-right"
                  />
                  <TableHead>
                    <span className="inline-flex items-center gap-1">
                      Status
                      <Popover>
                        <PopoverTrigger
                          render={<Button variant="ghost" size="icon-xs" className="-my-1" />}
                        >
                          <Info className="size-3.5 text-muted-foreground" />
                          <span className="sr-only">O que cada status significa</span>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                          <p className="mb-2 text-sm font-medium">Como o status é calculado</p>
                          <dl className="flex flex-col gap-2 text-sm">
                            {STATUS_LEGEND.map((item) => (
                              <div key={item.status}>
                                <dt className="font-medium">{item.status}</dt>
                                <dd className="text-muted-foreground">{item.criteria}</dd>
                              </div>
                            ))}
                          </dl>
                        </PopoverContent>
                      </Popover>
                    </span>
                  </TableHead>
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
                    <TableCell className="text-muted-foreground">
                      <Tooltip>
                        <TooltipTrigger
                          render={<span className="cursor-help underline decoration-dotted underline-offset-4" />}
                        >
                          {formatStatus(p.status)}
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">{p.confidenceNote}</TooltipContent>
                      </Tooltip>
                    </TableCell>
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
                {configuration.historicalDays ? (
                  <ConfigItem
                    label="Dias de histórico"
                    value={`${configuration.historicalDays} (a partir de hoje)`}
                  />
                ) : (
                  <ConfigItem
                    label="Período analisado"
                    value={`${formatDate(configuration.startDate)} – ${formatDate(configuration.endDate)}`}
                  />
                )}
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
                <ConfigItem label="Top N" value={configuration.topN ? String(configuration.topN) : "Todos"} />
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

"use client";

import { use, useState } from "react";
import { useBacktestPlus } from "@/lib/api-client/backtest-plus";
import {
  BACKTEST_PLUS_MODEL_LABELS,
  BacktestPlusCandidate,
  BacktestPlusEntry,
  BacktestPlusModel,
  MultiPeriodClassification,
  MultiPeriodMomentumTrend,
  MultiPeriodRecommendation,
} from "@/lib/api-client/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RenameBacktestPlusDialog } from "@/components/rename-backtest-plus-dialog";
import { formatDate, formatDateTime, formatRatioPercent, formatStatus } from "@/lib/format";
import { ChevronDown, ChevronRight } from "lucide-react";

const CLASSIFICATION_LABELS: Record<MultiPeriodClassification, string> = {
  excelente: "Excelente",
  forte: "Forte",
  bom: "Bom",
  observar: "Observar",
  descartar: "Descartar",
};

const RECOMMENDATION_LABELS: Record<MultiPeriodRecommendation, string> = {
  a_favor: "A favor",
  contra: "Contra",
  observar: "Observar",
  descartar: "Descartar",
};

const MOMENTUM_LABELS: Record<MultiPeriodMomentumTrend, string> = {
  fortalecendo: "Fortalecendo",
  estavel: "Estável",
  enfraquecendo: "Enfraquecendo",
  possivel_inversao: "Possível inversão",
};

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

/** Barra Tailwind simples (mesmo padrão de FrequencyBar em analyses-plus) — sem dependência de gráfico nova. */
function MetricBar({ label, pct, display }: { label: string; pct: number; display: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right font-medium tabular-nums">{display}</span>
    </div>
  );
}

function formatPrice(value: string | null): string {
  if (value === null) return "—";
  return Number(value).toFixed(5);
}

function ENTRY_RESULT_VARIANT(result: BacktestPlusEntry["result"]): "default" | "destructive" | "secondary" | "outline" {
  if (result === "win") return "default";
  if (result === "loss") return "destructive";
  if (result === "tie") return "secondary";
  return "outline"; // invalid
}

/**
 * Badge "#N" = posição ORIGINAL do candidato dentro do pool de 10 (poolRank
 * + 1), não a ordem cronológica da entrada no dia — a mesma identificação
 * numérica é usada na aba "Pool de candidatos" e no "Plano de entradas
 * utilizado", pra dar pra cruzar as duas visualizações. Só exibição: não
 * lê nem deriva nada além do que já veio persistido em `candidate`.
 */
function PoolPositionBadge({ candidate }: { candidate: BacktestPlusCandidate | null }) {
  if (!candidate) return <Badge variant="outline">?</Badge>;
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="outline" className="cursor-help tabular-nums" />}>
        #{candidate.poolRank + 1}
      </TooltipTrigger>
      <TooltipContent className="flex flex-col gap-0.5">
        <span className="font-medium">
          #{candidate.poolRank + 1} · {candidate.symbol}
        </span>
        <span>
          {candidate.timeOfDay} · {candidate.direction}
        </span>
        <span>Score {candidate.confidenceScore}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function ScoreboardTable({ models }: { models: BacktestPlusModel[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Modelo</TableHead>
          <TableHead className="text-right">Taxa 0/N</TableHead>
          <TableHead className="text-right">Sucesso diário</TableHead>
          <TableHead className="text-right">Acerto individual</TableHead>
          <TableHead className="text-right">Vitórias</TableHead>
          <TableHead className="text-right">Derrotas</TableHead>
          <TableHead className="text-right">Méd. até 1ª vitória</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((m) => (
          <TableRow key={m.id} className={m.rankPosition === 1 ? "bg-primary/5" : undefined}>
            <TableCell className="text-muted-foreground">{m.rankPosition}</TableCell>
            <TableCell className="font-medium">
              <span className="inline-flex items-center gap-2">
                {BACKTEST_PLUS_MODEL_LABELS[m.modelType]}
                {m.rankPosition === 1 && <Badge>Melhor</Badge>}
              </span>
            </TableCell>
            <TableCell className="text-right font-semibold">
              {formatRatioPercent(m.zeroOfNRate)}{" "}
              <span className="text-xs text-muted-foreground">
                ({m.zeroOfN}/{m.daysTested})
              </span>
            </TableCell>
            <TableCell className="text-right">{formatRatioPercent(m.dailySuccessRate)}</TableCell>
            <TableCell className="text-right">{formatRatioPercent(m.individualHitRate)}</TableCell>
            <TableCell className="text-right">{m.totalWins}</TableCell>
            <TableCell className="text-right">{m.totalLosses}</TableCell>
            <TableCell className="text-right">
              {m.averageEntriesUntilFirstWin !== null ? Number(m.averageEntriesUntilFirstWin).toFixed(2) : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function FirstWinAndCoverage({ model, entriesPerDay }: { model: BacktestPlusModel; entriesPerDay: number }) {
  const positions = [
    { pos: 1, count: model.firstWinAt1, cov: model.coverageAt1 },
    { pos: 2, count: model.firstWinAt2, cov: model.coverageAt2 },
    { pos: 3, count: model.firstWinAt3, cov: model.coverageAt3 },
    { pos: 4, count: model.firstWinAt4, cov: model.coverageAt4 },
    ...(entriesPerDay === 5 ? [{ pos: 5, count: model.firstWinAt5 ?? 0, cov: model.coverageAt5 ?? "0" }] : []),
  ];

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Distribuição da 1ª vitória
        </p>
        <div className="flex flex-col gap-1.5">
          {positions.map((p) => (
            <MetricBar
              key={p.pos}
              label={`Entrada ${p.pos}`}
              pct={model.daysTested > 0 ? (p.count / model.daysTested) * 100 : 0}
              display={`${p.count} dia(s)`}
            />
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Cobertura acumulada (observada neste backtest)
        </p>
        <div className="flex flex-col gap-1.5">
          {positions.map((p) => (
            <MetricBar key={p.pos} label={`Até entrada ${p.pos}`} pct={Number(p.cov) * 100} display={formatRatioPercent(p.cov)} />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          % de dias, dentro deste backtest, em que a 1ª vitória ocorreu até aquela posição — um resultado
          histórico observado, não uma probabilidade futura.
        </p>
      </div>
    </div>
  );
}

function EntryDetailTable({ entries }: { entries: BacktestPlusEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-right">Ordem</TableHead>
          <TableHead>Posição</TableHead>
          <TableHead>Par</TableHead>
          <TableHead>Horário</TableHead>
          <TableHead>Previsto → Real</TableHead>
          <TableHead>Resultado</TableHead>
          <TableHead className="text-right">Abertura</TableHead>
          <TableHead className="text-right">Máxima</TableHead>
          <TableHead className="text-right">Mínima</TableHead>
          <TableHead className="text-right">Fechamento</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="text-right text-muted-foreground">{e.entryOrder}</TableCell>
            <TableCell>
              <PoolPositionBadge candidate={e.candidate} />
            </TableCell>
            <TableCell className="font-medium">{e.candidate?.symbol ?? "—"}</TableCell>
            <TableCell>{e.candidate?.timeOfDay ?? "—"}</TableCell>
            <TableCell>
              {e.candidate?.direction ?? "—"} → {e.actualDirection ?? "—"}
            </TableCell>
            <TableCell>
              <Badge variant={ENTRY_RESULT_VARIANT(e.result)}>
                {formatStatus(e.result)}
                {e.invalidReason && ` (${formatStatus(e.invalidReason)})`}
              </Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatPrice(e.candleOpen)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPrice(e.candleHigh)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPrice(e.candleLow)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPrice(e.candleClose)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ExpandableDayRow({ date, entries }: { date: string; entries: BacktestPlusEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const wins = entries.filter((e) => e.result === "win").length;
  const losses = entries.filter((e) => e.result === "loss").length;
  const invalids = entries.filter((e) => e.result === "invalid").length;
  const validCount = entries.length - invalids;
  const dayLabel = validCount === 0 ? "Sem dado" : wins > 0 ? "Sucesso" : "0/N";
  const dayVariant = validCount === 0 ? "outline" : wins > 0 ? "default" : "destructive";

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <TableCell className="w-6">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </TableCell>
        <TableCell className="font-medium">{formatDate(date)}</TableCell>
        <TableCell className="text-right">{entries.length}</TableCell>
        <TableCell className="text-right">{wins}</TableCell>
        <TableCell className="text-right">{losses}</TableCell>
        <TableCell className="text-right">{invalids}</TableCell>
        <TableCell>
          <Badge variant={dayVariant}>{dayLabel}</Badge>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className="p-0">
            <div className="p-3">
              <EntryDetailTable entries={entries} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * "Plano de entradas utilizado": pra cada dia, quais posições do pool de 10
 * o modelo usou. Duas leituras da MESMA lista de entradas já persistida —
 * nada é reexecutado nem recalculado:
 *   - "Posições selecionadas": as mesmas `entries`, só reordenadas (na tela)
 *     por `candidate.poolRank` crescente — pra responder "quais dos #1..#10
 *     entraram nesse dia", independente da ordem em que aconteceram.
 *   - "Ordem cronológica": as mesmas `entries`, ordenadas por `entryOrder`
 *     (o campo já salvo no backtest) — nunca um horário recalculado aqui.
 */
function EntryPlanTable({ days }: { days: Array<[string, BacktestPlusEntry[]]> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Posições selecionadas</TableHead>
          <TableHead>Ordem cronológica</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {days.map(([date, entries]) => {
          const byPosition = [...entries].sort((a, b) => (a.candidate?.poolRank ?? 0) - (b.candidate?.poolRank ?? 0));
          const byChronological = [...entries].sort((a, b) => a.entryOrder - b.entryOrder);
          return (
            <TableRow key={date}>
              <TableCell className="font-medium whitespace-nowrap">{formatDate(date)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {byPosition.map((e) => (
                    <PoolPositionBadge key={e.id} candidate={e.candidate} />
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1">
                  {byChronological.map((e, i) => (
                    <span key={e.id} className="inline-flex items-center gap-1">
                      <PoolPositionBadge candidate={e.candidate} />
                      {i < byChronological.length - 1 && <span className="text-muted-foreground">→</span>}
                    </span>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function groupByDate(entries: BacktestPlusEntry[]): Array<[string, BacktestPlusEntry[]]> {
  const map = new Map<string, BacktestPlusEntry[]>();
  for (const e of entries) {
    const list = map.get(e.targetDate) ?? [];
    list.push(e);
    map.set(e.targetDate, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function ModelDetail({ model, entriesPerDay }: { model: BacktestPlusModel; entriesPerDay: number }) {
  const days = groupByDate(model.entries);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-6 pt-6 sm:grid-cols-3 lg:grid-cols-6">
          <StatBox label="Dias testados" value={String(model.daysTested)} />
          <StatBox label="Dias de sucesso" value={String(model.successfulDays)} />
          <StatBox label="Dias 0/N" value={String(model.failedDays)} />
          <StatBox label="Entradas inválidas" value={String(model.invalidEntries)} />
          <StatBox label="Empates" value={String(model.totalTies)} />
          <StatBox
            label="Méd./Med. até 1ª vitória"
            value={
              model.averageEntriesUntilFirstWin !== null
                ? `${Number(model.averageEntriesUntilFirstWin).toFixed(2)} / ${Number(model.medianEntriesUntilFirstWin).toFixed(2)}`
                : "—"
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1ª vitória e cobertura</CardTitle>
        </CardHeader>
        <CardContent>
          <FirstWinAndCoverage model={model} entriesPerDay={entriesPerDay} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plano de entradas utilizado</CardTitle>
          <CardDescription>
            #1 a #10 identificam a posição original do candidato dentro do pool — não a ordem de entrada no
            dia. Passe o mouse sobre uma posição para ver o par/horário/direção/score.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EntryPlanTable days={days} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dia a dia</CardTitle>
          <CardDescription>Clique numa linha para ver o detalhe OHLC de cada entrada.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6" />
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Entradas</TableHead>
                <TableHead className="text-right">Vitórias</TableHead>
                <TableHead className="text-right">Derrotas</TableHead>
                <TableHead className="text-right">Inválidas</TableHead>
                <TableHead>Resultado do dia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map(([date, entries]) => (
                <ExpandableDayRow key={date} date={date} entries={entries} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CandidatesAuditTable({ candidates }: { candidates: BacktestPlusCandidate[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Posição</TableHead>
          <TableHead>Par</TableHead>
          <TableHead>Horário</TableHead>
          <TableHead>Direção</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead>Classificação</TableHead>
          <TableHead>Recomendação</TableHead>
          <TableHead>Momentum</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {candidates.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <Badge variant="outline" className="tabular-nums">
                #{c.poolRank + 1}
              </Badge>
            </TableCell>
            <TableCell className="font-medium">{c.symbol}</TableCell>
            <TableCell>{c.timeOfDay}</TableCell>
            <TableCell>
              <Badge variant={c.direction === "CALL" ? "default" : "secondary"}>{c.direction}</Badge>
            </TableCell>
            <TableCell className="text-right font-semibold">{c.confidenceScore}</TableCell>
            <TableCell>{CLASSIFICATION_LABELS[c.classification]}</TableCell>
            <TableCell>{RECOMMENDATION_LABELS[c.recommendation]}</TableCell>
            <TableCell>{MOMENTUM_LABELS[c.momentumTrend]}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function BacktestPlusDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const detail = useBacktestPlus(id);
  const [selectedModelType, setSelectedModelType] = useState<string | undefined>(undefined);

  if (detail.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!detail.data) return <p className="text-sm text-destructive">Backtest Plus não encontrado.</p>;

  const { backtestPlus: b, candidates, models } = detail.data;
  const selectedModel = models.find((m) => m.modelType === (selectedModelType ?? models[0]?.modelType));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {b.name ?? <span className="text-muted-foreground italic">Backtest Plus sem nome</span>}
            </h1>
            <RenameBacktestPlusDialog backtestId={b.id} currentName={b.name} />
          </div>
          <p className="text-muted-foreground">
            Criado em {formatDateTime(b.createdAt)} · Referência: {formatDateTime(b.referenceDate)}
          </p>
        </div>
        <Badge variant={b.status === "error" ? "destructive" : "secondary"}>{formatStatus(b.status)}</Badge>
      </div>

      {b.status === "error" && b.errorMessage && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{b.errorMessage}</CardContent>
        </Card>
      )}

      {b.status === "completed" && (
        <>
          <Card>
            <CardContent className="grid grid-cols-2 gap-6 pt-6 sm:grid-cols-3 lg:grid-cols-5">
              <StatBox label="Entradas/dia" value={String(b.entriesPerDay)} />
              <StatBox label="Dias pedidos" value={String(b.forwardDaysRequested)} />
              <StatBox label="Dias testados" value={String(b.daysTested ?? 0)} />
              <StatBox
                label="Período efetivo"
                value={b.effectiveStartDate && b.effectiveEndDate ? `${formatDate(b.effectiveStartDate)} – ${formatDate(b.effectiveEndDate)}` : "—"}
              />
              <StatBox label="Melhor modelo" value={b.bestModel ? BACKTEST_PLUS_MODEL_LABELS[b.bestModel] : "—"} />
            </CardContent>
          </Card>

          <Tabs defaultValue="scoreboard">
            <TabsList>
              <TabsTrigger value="scoreboard">Placar comparativo</TabsTrigger>
              <TabsTrigger value="detail">Detalhe por modelo</TabsTrigger>
              <TabsTrigger value="pool">Pool de candidatos ({candidates.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="scoreboard" className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">5 modelos, ordenados por menor taxa 0/N</CardTitle>
                  <CardDescription>
                    O objetivo primário é minimizar dias 0/N (todas as entradas do dia perdedoras) — não
                    maximizar vitórias totais.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScoreboardTable models={models} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="detail" className="flex flex-col gap-4">
              <div className="w-56">
                <Select
                  items={Object.fromEntries(models.map((m) => [m.modelType, BACKTEST_PLUS_MODEL_LABELS[m.modelType]]))}
                  value={selectedModel?.modelType}
                  onValueChange={(v) => v && setSelectedModelType(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.modelType} value={m.modelType}>
                        {BACKTEST_PLUS_MODEL_LABELS[m.modelType]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedModel && <ModelDetail model={selectedModel} entriesPerDay={b.entriesPerDay} />}
            </TabsContent>

            <TabsContent value="pool">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Snapshot congelado no momento da criação</CardTitle>
                  <CardDescription>
                    Estes valores refletem exatamente o estado da Análise Plus em {formatDateTime(b.referenceDate)}{" "}
                    — mesmo que a análise de origem seja reprocessada depois, este pool não muda.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CandidatesAuditTable candidates={candidates} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {(b.status === "pending" || b.status === "processing") && (
        <p className="text-sm text-muted-foreground">Processando...</p>
      )}
    </div>
  );
}

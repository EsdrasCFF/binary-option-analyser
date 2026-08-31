"use client";

import { use, useState } from "react";
import {
  useMultiPeriodAnalysis,
  useMultiPeriodPatternResult,
  useMultiPeriodPatternResults,
  useMultiPeriodTop5,
} from "@/lib/api-client/multi-period-analyses";
import {
  MultiPeriodClassification,
  MultiPeriodMomentumTrend,
  MultiPeriodPatternResultDetail,
  MultiPeriodPatternResultSummary,
  MultiPeriodRecommendation,
} from "@/lib/api-client/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatPercent, formatStatus } from "@/lib/format";
import { ChevronDown, ChevronRight } from "lucide-react";

const CLASSIFICATION_LABELS: Record<MultiPeriodClassification, string> = {
  excelente: "Excelente",
  forte: "Forte",
  bom: "Bom",
  observar: "Observar",
  descartar: "Descartar",
};

const CLASSIFICATION_VARIANT: Record<MultiPeriodClassification, "default" | "secondary" | "destructive"> = {
  excelente: "default",
  forte: "default",
  bom: "secondary",
  observar: "secondary",
  descartar: "destructive",
};

const RECOMMENDATION_LABELS: Record<MultiPeriodRecommendation, string> = {
  a_favor: "A favor",
  contra: "Contra",
  observar: "Observar",
  descartar: "Descartar",
};

const RECOMMENDATION_VARIANT: Record<MultiPeriodRecommendation, "default" | "secondary" | "destructive" | "outline"> = {
  a_favor: "default",
  contra: "destructive",
  observar: "secondary",
  descartar: "outline",
};

const MOMENTUM_LABELS: Record<MultiPeriodMomentumTrend, string> = {
  fortalecendo: "Fortalecendo",
  estavel: "Estável",
  enfraquecendo: "Enfraquecendo",
  possivel_inversao: "Possível inversão",
};

function ClassificationBadge({ value }: { value: MultiPeriodClassification }) {
  return <Badge variant={CLASSIFICATION_VARIANT[value]}>{CLASSIFICATION_LABELS[value]}</Badge>;
}

function RecommendationBadge({ value }: { value: MultiPeriodRecommendation }) {
  return <Badge variant={RECOMMENDATION_VARIANT[value]}>{RECOMMENDATION_LABELS[value]}</Badge>;
}

function FrequencyBar({ label, pct, sublabel }: { label: string; pct: number; sublabel?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right font-medium tabular-nums">{pct.toFixed(2)}%</span>
      {sublabel && <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">{sublabel}</span>}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

/**
 * "ANÁLISE MULTIPERÍODO" — o mesmo bloco de detalhe usado tanto na linha
 * expandida da tabela quanto no card do Top 5 (seção 14-15 do briefing).
 */
function MultiPeriodBreakdown({ detail }: { detail: MultiPeriodPatternResultDetail }) {
  return (
    <div className="flex flex-col gap-4 rounded-md border bg-muted/30 p-4">
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Frequência {detail.direction}</p>
        <div className="flex flex-col gap-1.5">
          {detail.windows.map((w) => (
            <FrequencyBar key={w.days} label={`${w.days}D`} pct={Number(w.frequency)} sublabel={`${w.validSamples} ocorrências`} />
          ))}
          {detail.momentumWindow && (
            <div className="mt-1 border-t pt-1.5">
              <FrequencyBar
                label={`${detail.momentumWindow.days}D`}
                pct={Number(detail.momentumWindow.frequency)}
                sublabel="momentum (recente)"
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3 sm:grid-cols-4">
        <StatBox label="Média estrutural" value={formatPercent(detail.structuralAverage)} />
        <StatBox label="Range" value={`${Number(detail.stabilityRange).toFixed(2)} p.p.`} />
        <StatBox label="Desvio padrão" value={`${Number(detail.stabilityStdDev).toFixed(2)} p.p.`} />
        <StatBox
          label="Persistência"
          value={`${detail.persistenceConfirmed}/${detail.persistenceTotal} (${formatPercent(detail.persistencePercentage)})`}
        />
        <StatBox label="Dias válidos" value={String(detail.totalValid)} />
        <StatBox label="Amostra (mín. entre janelas)" value={String(detail.sampleMin)} />
        <StatBox label="Momentum" value={MOMENTUM_LABELS[detail.momentumTrend]} />
        <StatBox label="Score" value={`${detail.confidenceScore}/100`} />
        <StatBox
          label="Subtotais"
          value={`P${detail.scorePersistence} F${detail.scoreFrequency} E${detail.scoreStability} A${detail.scoreSample} M${detail.scoreMomentum}`}
        />
      </div>
    </div>
  );
}

function ExpandablePatternRow({ item }: { item: MultiPeriodPatternResultSummary }) {
  const [expanded, setExpanded] = useState(false);
  const detail = useMultiPeriodPatternResult(expanded ? item.id : undefined);

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <TableCell className="w-6">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </TableCell>
        <TableCell className="font-medium">{item.symbol}</TableCell>
        <TableCell>{item.timeOfDay}</TableCell>
        <TableCell>
          <Badge variant={item.direction === "CALL" ? "default" : "secondary"}>{item.direction}</Badge>
        </TableCell>
        <TableCell className="text-right">{formatPercent(item.structuralAverage)}</TableCell>
        <TableCell className="text-right">{item.totalValid}</TableCell>
        <TableCell className="text-right font-semibold">{item.confidenceScore}</TableCell>
        <TableCell>{MOMENTUM_LABELS[item.momentumTrend]}</TableCell>
        <TableCell>
          <RecommendationBadge value={item.recommendation} />
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={9} className="p-0">
            <div className="p-3">
              {detail.isLoading || !detail.data ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <MultiPeriodBreakdown detail={detail.data} />
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TopPatternCard({ rank, item }: { rank: number; item: MultiPeriodPatternResultDetail }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="text-muted-foreground">#{rank}</span>
            {item.symbol} · {item.timeOfDay}
            <Badge variant={item.direction === "CALL" ? "default" : "secondary"}>{item.direction}</Badge>
          </CardTitle>
          <CardDescription>
            Score {item.confidenceScore}/100 · <ClassificationBadge value={item.classification} />
          </CardDescription>
        </div>
        <RecommendationBadge value={item.recommendation} />
      </CardHeader>
      <CardContent>
        <MultiPeriodBreakdown detail={item} />
      </CardContent>
    </Card>
  );
}

export default function MultiPeriodAnalysisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const analysis = useMultiPeriodAnalysis(id);
  const top5 = useMultiPeriodTop5(id);
  const patternResults = useMultiPeriodPatternResults({ analysisId: id, sortBy: "confidenceScore", order: "desc", limit: 200 });

  if (analysis.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!analysis.data) return <p className="text-sm text-destructive">Análise não encontrada.</p>;

  const { analysis: a, configuration, patternResultCount } = analysis.data;

  // mesmo cálculo do motor (referenceDate - maxDays dias) — só pra exibição,
  // não afeta nada do processamento em si.
  const periodStart =
    a.referenceDate && configuration
      ? new Date(new Date(a.referenceDate).getTime() - configuration.maxDays * 24 * 60 * 60 * 1000)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{a.name}</h1>
          <p className="text-muted-foreground">
            Criada em {formatDateTime(a.createdAt)}
            {a.referenceDate && <> · Referência: {formatDateTime(a.referenceDate)}</>}
          </p>
        </div>
        <Badge variant={a.status === "error" ? "destructive" : "secondary"}>{formatStatus(a.status)}</Badge>
      </div>

      {a.status === "error" && a.errorMessage && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{a.errorMessage}</CardContent>
        </Card>
      )}

      <Tabs defaultValue="top5">
        <TabsList>
          <TabsTrigger value="top5">Top 5</TabsTrigger>
          <TabsTrigger value="all">Todos os padrões ({patternResultCount})</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
        </TabsList>

        <TabsContent value="top5" className="flex flex-col gap-4">
          {top5.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : top5.data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum padrão encontrado nesta análise.</p>
          ) : (
            top5.data?.items.map((item, i) => <TopPatternCard key={item.id} rank={i + 1} item={item} />)
          )}
        </TabsContent>

        <TabsContent value="all" className="flex flex-col gap-4">
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
                  <TableHead className="text-right">Repetição</TableHead>
                  <TableHead className="text-right">Dias válidos</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Tendência</TableHead>
                  <TableHead>Recomendação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patternResults.data?.items.map((item) => (
                  <ExpandablePatternRow key={item.id} item={item} />
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
                <ConfigItem
                  label="Modo do período"
                  value={configuration.startDate ? "Período específico" : "Últimos N dias (a partir de hoje)"}
                />
                <ConfigItem label="Período máximo" value={`${configuration.maxDays} dias`} />
                <ConfigItem label="Data inicial" value={periodStart ? formatDateTime(periodStart) : "—"} />
                <ConfigItem label="Data final" value={a.referenceDate ? formatDateTime(a.referenceDate) : "—"} />
                <ConfigItem label="Timezone" value={configuration.timezone} />
                <ConfigItem
                  label="Janela de horário"
                  value={
                    configuration.startTime || configuration.endTime
                      ? `${configuration.startTime ?? "00:00"} – ${configuration.endTime ?? "23:59"}`
                      : "Dia todo"
                  }
                />
                <ConfigItem label="% mínimo de persistência" value={formatPercent(configuration.persistenceThresholdPct)} />
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

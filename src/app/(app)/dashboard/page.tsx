"use client";

import Link from "next/link";
import { LineChart, ListChecks, TrendingUp, Wallet } from "lucide-react";
import { useAnalyses } from "@/lib/api-client/analyses";
import { useBacktests } from "@/lib/api-client/backtests";
import { useCurrencyPairs } from "@/lib/api-client/currency-pairs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDateTime, formatStatus } from "@/lib/format";

function StatCard({
  title,
  value,
  icon: Icon,
  loading,
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{value}</div>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const analyses = useAnalyses();
  const backtests = useBacktests();
  const currencyPairs = useCurrencyPairs();

  const completedBacktests = backtests.data?.items.filter((b) => b.status === "completed") ?? [];
  const bestBacktest = [...completedBacktests].sort(
    (a, b) => Number(b.finalBankroll ?? 0) - Number(a.finalBankroll ?? 0)
  )[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral das suas análises e backtests.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Pares com dados"
          value={String(currencyPairs.data?.items.length ?? 0)}
          icon={Wallet}
          loading={currencyPairs.isLoading}
        />
        <StatCard
          title="Análises"
          value={String(analyses.data?.items.length ?? 0)}
          icon={LineChart}
          loading={analyses.isLoading}
        />
        <StatCard
          title="Backtests"
          value={String(backtests.data?.items.length ?? 0)}
          icon={ListChecks}
          loading={backtests.isLoading}
        />
        <StatCard
          title="Melhor banca final"
          value={bestBacktest ? formatCurrency(bestBacktest.finalBankroll) : "—"}
          icon={TrendingUp}
          loading={backtests.isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Análises recentes</CardTitle>
            <CardDescription>As últimas análises criadas.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {analyses.isLoading && <Skeleton className="h-24 w-full" />}
            {analyses.data?.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma análise ainda.{" "}
                <Link href="/analyses/new" className="underline underline-offset-4">
                  Criar a primeira
                </Link>
                .
              </p>
            )}
            {analyses.data?.items.slice(0, 5).map((a) => (
              <Link
                key={a.id}
                href={`/analyses/${a.id}`}
                className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted"
              >
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</p>
                </div>
                <Badge variant={a.status === "error" ? "destructive" : "secondary"}>
                  {formatStatus(a.status)}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Backtests recentes</CardTitle>
            <CardDescription>As últimas simulações executadas.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {backtests.isLoading && <Skeleton className="h-24 w-full" />}
            {backtests.data?.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum backtest ainda.{" "}
                <Link href="/backtests/new" className="underline underline-offset-4">
                  Criar o primeiro
                </Link>
                .
              </p>
            )}
            {backtests.data?.items.slice(0, 5).map((b) => (
              <Link
                key={b.id}
                href={`/backtests/${b.id}`}
                className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted"
              >
                <div>
                  <p className="font-medium">
                    {b.totalOperations ?? 0} operações · {formatCurrency(b.finalBankroll)}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(b.createdAt)}</p>
                </div>
                <Badge variant={b.status === "error" ? "destructive" : "secondary"}>
                  {formatStatus(b.status)}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3">
        <Button nativeButton={false} render={<Link href="/import/yahoo" />}>
          Importar candles
        </Button>
        <Button nativeButton={false} variant="outline" render={<Link href="/analyses/new" />}>
          Nova análise
        </Button>
      </div>
    </div>
  );
}

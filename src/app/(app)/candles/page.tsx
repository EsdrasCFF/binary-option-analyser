"use client";

import { useEffect, useMemo, useState } from "react";
import { useCurrencyPairs } from "@/lib/api-client/currency-pairs";
import { useCandles } from "@/lib/api-client/candles";
import { CandlestickChart } from "@/components/charts/candlestick-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { formatDate } from "@/lib/format";

/** yyyy-MM-dd no fuso local do navegador, pro `<input type="date">`. */
function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function CandlesPage() {
  const currencyPairs = useCurrencyPairs();
  // "" (nunca undefined) desde o primeiro render: mantém o Select controlado
  // o tempo todo — alternar entre não-controlado e controlado faz a Base UI
  // perder a label exibida no trigger.
  const [currencyPairId, setCurrencyPairId] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");

  const pairsWithData = useMemo(
    () => (currencyPairs.data?.items ?? []).filter((p) => p.timeframes.length > 0),
    [currencyPairs.data]
  );
  const selectedPair = pairsWithData.find((p) => p.id === currencyPairId);
  const selectedCoverage = selectedPair?.timeframes.find((t) => t.timeframe === timeframe);

  // seleciona o primeiro par com dado assim que a lista carrega
  useEffect(() => {
    if (!currencyPairId && pairsWithData.length > 0) {
      setCurrencyPairId(pairsWithData[0].id);
    }
  }, [currencyPairId, pairsWithData]);

  // troca de par: seleciona o primeiro timeframe disponível. Deps restrita de
  // propósito a `selectedPair?.id` — a única mudança externa que deve
  // disparar isso; incluir `timeframe` recriaria o efeito a cada troca que
  // ele mesmo provoca.
  useEffect(() => {
    if (!selectedPair) return;
    if (!selectedPair.timeframes.some((t) => t.timeframe === timeframe)) {
      setTimeframe(selectedPair.timeframes[0]?.timeframe);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPair?.id]);

  // troca de timeframe (ou de par): preenche o período com os últimos 7 dias
  // disponíveis pra esse timeframe (evita carregar milhares de candles à toa).
  // Mesma restrição de deps do efeito acima.
  useEffect(() => {
    if (!selectedCoverage) return;
    const last = new Date(selectedCoverage.lastCandle);
    const first = new Date(selectedCoverage.firstCandle);
    const suggestedFrom = new Date(Math.max(first.getTime(), last.getTime() - 7 * 24 * 60 * 60 * 1000));
    setFrom(toDateInputValue(suggestedFrom));
    setTo(toDateInputValue(last));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCoverage?.timeframe, selectedPair?.id]);

  const candles = useCandles({
    currencyPairId,
    timeframe,
    from: from ? new Date(`${from}T00:00:00Z`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59Z`).toISOString() : undefined,
    timeOfDay: timeOfDay || undefined,
    timezone: timeOfDay ? timezone : undefined,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visualização de velas</h1>
        <p className="text-muted-foreground">Escolha o par, o timeframe e o período pra ver os candles importados.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          {currencyPairs.isLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : pairsWithData.length === 0 ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle>Nenhum candle importado ainda</AlertTitle>
              <AlertDescription>Importe dados em &quot;Importar CSV&quot; ou &quot;Importar Yahoo Finance&quot; primeiro.</AlertDescription>
            </Alert>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="currencyPairId">Par</FieldLabel>
                <Select<string>
                  items={Object.fromEntries(pairsWithData.map((p) => [p.id, p.symbol] as const))}
                  value={currencyPairId}
                  onValueChange={(v) => v && setCurrencyPairId(v)}
                >
                  <SelectTrigger id="currencyPairId" className="w-full">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {pairsWithData.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="timeframe">Timeframe</FieldLabel>
                <Select<string>
                  items={Object.fromEntries((selectedPair?.timeframes ?? []).map((t) => [t.timeframe, t.timeframe] as const))}
                  value={timeframe}
                  onValueChange={(v) => v && setTimeframe(v)}
                >
                  <SelectTrigger id="timeframe" className="w-full">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedPair?.timeframes ?? []).map((t) => (
                      <SelectItem key={t.timeframe} value={t.timeframe}>
                        {t.timeframe} ({t.candleCount.toLocaleString("pt-BR")} candles)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="from">De</FieldLabel>
                <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="to">Até</FieldLabel>
                <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>

              <Field>
                <FieldLabel htmlFor="timeOfDay">Horário específico (opcional)</FieldLabel>
                <Input
                  id="timeOfDay"
                  type="time"
                  value={timeOfDay}
                  onChange={(e) => setTimeOfDay(e.target.value)}
                />
              </Field>
              {timeOfDay && (
                <Field>
                  <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
                  <Input
                    id="timezone"
                    type="text"
                    placeholder="America/Sao_Paulo"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  />
                </Field>
              )}
            </div>
          )}

          {selectedCoverage && (
            <p className="mt-3 text-sm text-muted-foreground">
              Dados disponíveis para {selectedPair?.symbol} {selectedCoverage.timeframe}:{" "}
              {formatDate(selectedCoverage.firstCandle)} – {formatDate(selectedCoverage.lastCandle)}.
            </p>
          )}
        </CardContent>
      </Card>

      {currencyPairId && timeframe && (
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedPair?.symbol} · {timeframe}
              {timeOfDay && ` · ${timeOfDay} (${timezone})`}
            </CardTitle>
            {candles.data && (
              <CardDescription>
                {candles.data.items.length.toLocaleString("pt-BR")} candle(s) exibido(s)
                {candles.data.truncated
                  ? ` de ${candles.data.total.toLocaleString("pt-BR")} no período — refine o intervalo pra ver tudo.`
                  : "."}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {candles.isLoading ? (
              <Skeleton className="h-[480px] w-full" />
            ) : !candles.data || candles.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum candle nesse período.</p>
            ) : (
              <>
                {candles.data.truncated && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertTriangle />
                    <AlertTitle>Período truncado</AlertTitle>
                    <AlertDescription>
                      O intervalo tem mais candles do que o limite de exibição — mostrando os {candles.data.limit}{" "}
                      mais recentes dentro do período escolhido.
                    </AlertDescription>
                  </Alert>
                )}
                <CandlestickChart candles={candles.data.items} />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

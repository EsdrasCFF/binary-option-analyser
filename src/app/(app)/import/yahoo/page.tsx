"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useImportYahoo } from "@/lib/api-client/candles";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "1d"];

export default function ImportYahooPage() {
  const [symbols, setSymbols] = useState("EUR/USD");
  const [timeframe, setTimeframe] = useState("5m");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const importYahoo = useImportYahoo();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const symbolList = symbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (symbolList.length === 0) {
      toast.error("Informe ao menos um par (ex: EUR/USD).");
      return;
    }
    importYahoo.mutate(
      {
        symbols: symbolList,
        timeframe,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
      },
      {
        onSuccess: (result) => {
          toast.success(`${result.importedRows} candles importados de ${symbolList.join(", ")}.`);
        },
        onError: (err) => {
          toast.error(err instanceof ApiClientError ? err.message : "Falha ao importar.");
        },
      }
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importar candles (Yahoo Finance)</h1>
        <p className="text-muted-foreground">
          Dados reais de mercado, sem CSV. Endpoint não-oficial — histórico intraday é limitado a uma janela
          móvel recente (1m: 8 dias; 5m/15m/30m: 60 dias; 1h+: bem mais).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parâmetros</CardTitle>
          <CardDescription>Deixe de/até em branco para trazer todo o histórico disponível.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="symbols">Pares (separados por vírgula)</FieldLabel>
                <Input
                  id="symbols"
                  placeholder="EUR/USD, GBP/USD"
                  value={symbols}
                  onChange={(e) => setSymbols(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="timeframe">Timeframe</FieldLabel>
                <Select
                  items={Object.fromEntries(TIMEFRAMES.map((tf) => [tf, tf]))}
                  value={timeframe}
                  onValueChange={(value) => value && setTimeframe(value)}
                >
                  <SelectTrigger id="timeframe" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEFRAMES.map((tf) => (
                      <SelectItem key={tf} value={tf}>
                        {tf}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="from">De (opcional)</FieldLabel>
                  <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="to">Até (opcional)</FieldLabel>
                  <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </div>
              <FieldDescription>
                Formato do par: EUR/USD (forex). Timeframes suportados: {TIMEFRAMES.join(", ")}.
              </FieldDescription>
              <Button type="submit" disabled={importYahoo.isPending}>
                {importYahoo.isPending ? "Importando..." : "Importar"}
              </Button>
            </FieldGroup>
          </form>

          {importYahoo.data && (
            <div className="mt-6 flex flex-col gap-3">
              <Alert>
                <CheckCircle2 />
                <AlertTitle>Importação concluída</AlertTitle>
                <AlertDescription>
                  {importYahoo.data.importedRows} novos candles, {importYahoo.data.duplicateRows} já existiam.
                </AlertDescription>
              </Alert>
              {importYahoo.data.warning && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Janela ajustada</AlertTitle>
                  <AlertDescription>{importYahoo.data.warning}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

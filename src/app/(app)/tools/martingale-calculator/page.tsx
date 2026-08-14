"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useCalculateMartingale } from "@/lib/api-client/martingale";
import { useBankrollConfigurations } from "@/lib/api-client/bankroll-configurations";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatPercent } from "@/lib/format";

export default function MartingaleCalculatorPage() {
  const [bankroll, setBankroll] = useState("1000");
  const [payoutPct, setPayoutPct] = useState("85");
  const [martingaleLevels, setMartingaleLevels] = useState("2");
  const [maxExposurePct, setMaxExposurePct] = useState("20");

  const bankrollConfigs = useBankrollConfigurations();
  const calculate = useCalculateMartingale();

  function applyPreset(id: string) {
    const preset = bankrollConfigs.data?.items.find((c) => c.id === id);
    if (!preset) return;
    setBankroll(preset.bankroll);
    setPayoutPct(preset.payoutPct);
    if (preset.maxExposurePct) setMaxExposurePct(preset.maxExposurePct);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    calculate.mutate(
      { bankroll, payoutPct, martingaleLevels: Number(martingaleLevels), maxExposurePct },
      {
        onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Falha ao calcular."),
      }
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calculadora de entradas</h1>
        <p className="text-muted-foreground">
          Cronograma de Martingale: o sistema descobre sozinho a entrada e o lucro mínimo de recuperação de cada
          nível, usando o máximo possível do percentual de exposição informado.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parâmetros</CardTitle>
          {bankrollConfigs.data && bankrollConfigs.data.items.length > 0 && (
            <CardDescription className="flex items-center gap-2 pt-2">
              <span>Carregar configuração salva:</span>
              <Select<string>
                items={Object.fromEntries(bankrollConfigs.data.items.map((c) => [c.id, c.name] as const))}
                onValueChange={(id) => id && applyPreset(id)}
              >
                <SelectTrigger className="w-56" size="sm">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {bankrollConfigs.data.items.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="bankroll">Banca</FieldLabel>
                  <Input id="bankroll" type="number" step="0.01" value={bankroll} onChange={(e) => setBankroll(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="payoutPct">Payout (%)</FieldLabel>
                  <Input id="payoutPct" type="number" step="0.1" value={payoutPct} onChange={(e) => setPayoutPct(e.target.value)} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="maxExposurePct">Exposição máxima (% da banca)</FieldLabel>
                  <Input
                    id="maxExposurePct"
                    type="number"
                    step="0.1"
                    value={maxExposurePct}
                    onChange={(e) => setMaxExposurePct(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="martingaleLevels">Níveis de Martingale</FieldLabel>
                  <Input
                    id="martingaleLevels"
                    type="number"
                    min={0}
                    max={5}
                    value={martingaleLevels}
                    onChange={(e) => setMartingaleLevels(e.target.value)}
                  />
                </Field>
              </div>
              <FieldDescription>
                Entrada inicial e lucro mínimo de recuperação não são digitados — o sistema calcula o maior lucro
                mínimo cuja soma de todas as entradas (nível 0 ao último) caiba no percentual de exposição acima.
              </FieldDescription>

              <Button type="submit" disabled={calculate.isPending}>
                {calculate.isPending ? "Calculando..." : "Calcular"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {calculate.data && (
        <Card>
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
            <CardDescription>
              Capital total necessário: {formatCurrency(calculate.data.totalCapitalRequired)} (
              {formatPercent(calculate.data.pctBankrollExposed)} da banca)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nível</TableHead>
                  <TableHead className="text-right">Entrada</TableHead>
                  <TableHead className="text-right">Lucro bruto</TableHead>
                  <TableHead className="text-right">Lucro líquido</TableHead>
                  <TableHead className="text-right">Exposição acumulada</TableHead>
                  <TableHead className="text-right">% da banca</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calculate.data.levels.map((level) => (
                  <TableRow key={level.levelIndex}>
                    <TableCell className="font-medium">{level.levelName}</TableCell>
                    <TableCell className="text-right">{formatCurrency(level.entryValue)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(level.grossProfitIfWin)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(level.netProfitAfterRecovery)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(level.accumulatedExposure)}</TableCell>
                    <TableCell className="text-right">{formatPercent(level.pctOfBankrollUsed)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

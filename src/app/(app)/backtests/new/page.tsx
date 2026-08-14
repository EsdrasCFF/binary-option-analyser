"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useCreateBacktest } from "@/lib/api-client/backtests";
import { useAnalysis } from "@/lib/api-client/analyses";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

const formSchema = z
  .object({
    entryStrategy: z.enum(["same_direction", "contrarian"]),
    payoutPct: z.coerce.number().gt(0).lte(100),
    initialBankroll: z.coerce.number().gt(0),
    initialEntry: z.coerce.number().gt(0),
    minProfit: z.coerce.number().gt(0),
    maxExposureLimit: z.coerce.number().optional(),
    dojiPolicy: z.enum(["ignore", "count_as_loss", "count_as_tie"]),
    periodStart: z.string().min(1, "Informe a data inicial."),
    periodEnd: z.string().min(1, "Informe a data final."),
  })
  .refine((v) => v.initialEntry <= v.initialBankroll, {
    message: "Entrada inicial não pode ser maior que a banca.",
    path: ["initialEntry"],
  })
  .refine((v) => new Date(v.periodStart) < new Date(v.periodEnd), {
    message: "Data inicial deve ser anterior à final.",
    path: ["periodEnd"],
  });

type FormValues = z.input<typeof formSchema>;

/** yyyy-MM-dd no fuso local do navegador, pro `<input type="date">`. */
function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export default function NewBacktestPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const patternResultIds = (searchParams.get("patternResultIds") ?? "").split(",").filter(Boolean);
  const analysisId = searchParams.get("analysisId") ?? undefined;
  const martingaleLevels = Math.max(patternResultIds.length - 1, 0);
  const createBacktest = useCreateBacktest();
  const analysis = useAnalysis(analysisId);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      entryStrategy: "contrarian",
      payoutPct: 85,
      initialBankroll: 1000,
      initialEntry: 5,
      minProfit: 1,
      dojiPolicy: "count_as_loss",
      periodStart: "",
      periodEnd: "",
    },
  });

  // Etapa 1 (Análise histórica) → Etapa 2 (Forward test): sugere como período
  // padrão o dia seguinte ao fim do período analisado até ontem — só um
  // default, o usuário pode sempre ajustar as datas manualmente.
  useEffect(() => {
    const configuration = analysis.data?.configuration;
    if (!configuration) return;

    const effectiveEnd = configuration.endDate
      ? new Date(configuration.endDate)
      : analysis.data?.analysis.createdAt
        ? new Date(analysis.data.analysis.createdAt)
        : null;
    if (!effectiveEnd) return;

    const yesterday = addDays(new Date(), -1);
    if (!dirtyFields.periodStart) setValue("periodStart", toDateInputValue(addDays(effectiveEnd, 1)));
    if (!dirtyFields.periodEnd) setValue("periodEnd", toDateInputValue(yesterday));
  }, [analysis.data, dirtyFields.periodStart, dirtyFields.periodEnd, setValue]);

  function onSubmit(values: FormValues) {
    const parsed = formSchema.parse(values);
    createBacktest.mutate(
      {
        patternResultIds,
        entryStrategy: parsed.entryStrategy,
        payoutPct: String(parsed.payoutPct),
        initialBankroll: String(parsed.initialBankroll),
        initialEntry: String(parsed.initialEntry),
        minProfit: String(parsed.minProfit),
        maxExposureLimit: parsed.maxExposureLimit ? String(parsed.maxExposureLimit) : undefined,
        dojiPolicy: parsed.dojiPolicy,
        periodStart: new Date(parsed.periodStart).toISOString(),
        periodEnd: new Date(parsed.periodEnd).toISOString(),
      },
      {
        onSuccess: (result) => {
          if (result.backtest.status === "error") {
            toast.error(result.backtest.errorMessage ?? "Falha ao processar o backtest.");
          } else {
            toast.success(
              result.processed
                ? `Backtest concluído: ${result.totalOperations ?? 0} operações.`
                : "Backtest criado."
            );
          }
          router.push(`/backtests/${result.backtest.id}`);
        },
        onError: (err) => {
          toast.error(err instanceof ApiClientError ? err.message : "Falha ao criar backtest.");
        },
      }
    );
  }

  if (patternResultIds.length === 0) {
    return (
      <div className="max-w-2xl">
        <Alert>
          <AlertTriangle />
          <AlertTitle>Nenhum padrão selecionado</AlertTitle>
          <AlertDescription>
            Escolha os horários a simular na aba &quot;Ranking de padrões&quot; de uma{" "}
            <Link href="/analyses" className="underline underline-offset-4">
              análise
            </Link>{" "}
            e clique em &quot;Criar backtest com selecionados&quot;.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo backtest</h1>
        <p className="text-muted-foreground">
          {patternResultIds.length} horário(s) selecionado(s) — {martingaleLevels} nível(is) de Martingale.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parâmetros</CardTitle>
          <CardDescription>
            Etapa 1 (Análise histórica) já rodou — ela define os {patternResultIds.length} horário(s) e os
            critérios usados a seguir. Etapa 2 (Forward test): a cada dia simulado do período abaixo, o motor
            refaz o ranking do zero usando só dados anteriores àquele dia (nunca olha o futuro) e monta a escada
            do dia com os melhores horários do momento, ordenados do mais cedo ao mais tarde. A entrada começa
            pelo nível 0; em caso de derrota, tenta o próximo horário da escada (não o candle seguinte do mesmo
            horário); assim que vencer, o dia encerra — o objetivo é 1 vitória por dia, não maximizar entradas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="periodStart">Início do forward test</FieldLabel>
                  <Input id="periodStart" type="date" {...register("periodStart")} />
                  <FieldError errors={[errors.periodStart]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="periodEnd">Fim do forward test</FieldLabel>
                  <Input id="periodEnd" type="date" {...register("periodEnd")} />
                  <FieldError errors={[errors.periodEnd]} />
                </Field>
              </div>
              {analysisId && (
                <FieldDescription>
                  Sugerido a partir do dia seguinte ao fim do período analisado até ontem — ajuste se quiser
                  testar outro intervalo.
                </FieldDescription>
              )}

              <div className="grid grid-cols-3 gap-4">
                <Field>
                  <FieldLabel htmlFor="payoutPct">Payout (%)</FieldLabel>
                  <Input id="payoutPct" type="number" step="0.1" {...register("payoutPct")} />
                  <FieldError errors={[errors.payoutPct]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="initialBankroll">Banca inicial</FieldLabel>
                  <Input id="initialBankroll" type="number" step="0.01" {...register("initialBankroll")} />
                  <FieldError errors={[errors.initialBankroll]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="initialEntry">Entrada inicial</FieldLabel>
                  <Input id="initialEntry" type="number" step="0.01" {...register("initialEntry")} />
                  <FieldError errors={[errors.initialEntry]} />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="minProfit">Lucro mínimo</FieldLabel>
                <Input id="minProfit" type="number" step="0.01" {...register("minProfit")} />
                <FieldError errors={[errors.minProfit]} />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="entryStrategy">Direção da operação</FieldLabel>
                  <Controller
                    control={control}
                    name="entryStrategy"
                    render={({ field }) => (
                      <Select
                        items={{ same_direction: "Seguir tendência", contrarian: "Contrário à tendência" }}
                        value={field.value}
                        onValueChange={(v) => v && field.onChange(v)}
                      >
                        <SelectTrigger id="entryStrategy" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="same_direction">Seguir tendência</SelectItem>
                          <SelectItem value="contrarian">Contrário à tendência</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="dojiPolicy">Política de DOJI</FieldLabel>
                  <Controller
                    control={control}
                    name="dojiPolicy"
                    render={({ field }) => (
                      <Select
                        items={{
                          ignore: "Ignorar (não conta)",
                          count_as_loss: "Contar como derrota",
                          count_as_tie: "Contar como empate",
                        }}
                        value={field.value}
                        onValueChange={(v) => v && field.onChange(v)}
                      >
                        <SelectTrigger id="dojiPolicy" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ignore">Ignorar (não conta)</SelectItem>
                          <SelectItem value="count_as_loss">Contar como derrota</SelectItem>
                          <SelectItem value="count_as_tie">Contar como empate</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="maxExposureLimit">Limite de exposição (opcional)</FieldLabel>
                <Input id="maxExposureLimit" type="number" step="0.01" {...register("maxExposureLimit")} />
                <FieldDescription>
                  Se o custo total da escada do dia (todos os níveis) ultrapassar esse valor, o backtest não abre
                  operação naquele dia.
                </FieldDescription>
              </Field>

              <Button type="submit" disabled={createBacktest.isPending}>
                {createBacktest.isPending ? "Simulando..." : "Criar e executar backtest"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

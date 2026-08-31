"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useCurrencyPairs } from "@/lib/api-client/currency-pairs";
import { useCreateMultiPeriodAnalysis } from "@/lib/api-client/multi-period-analyses";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveMaxDaysFromDateRange } from "@/lib/analysis/multi-period-analysis";

const WEEKDAYS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 7, label: "Dom" },
];

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "1d"];

const MIN_STRUCTURAL_DAYS = 50;

const formSchema = z
  .object({
    name: z.string().min(1, "Informe um nome."),
    currencyPairIds: z.array(z.string()).min(1, "Selecione ao menos um par."),
    timeframe: z.string().min(1),
    periodMode: z.enum(["days", "range"]),
    maxDays: z.coerce
      .number()
      .int()
      .min(MIN_STRUCTURAL_DAYS, `O período máximo precisa ser de pelo menos ${MIN_STRUCTURAL_DAYS} dias — é a menor janela estrutural.`)
      .refine((v) => v % 10 === 0, "Precisa ser um múltiplo de 10 (ex: 60, 70, 100, 150).")
      .optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    timezone: z.string().min(1, "Informe um timezone (ex: America/Sao_Paulo)."),
    weekdays: z.array(z.number()),
    dojiTolerancePct: z.coerce.number().min(0),
    dojiPolicy: z.enum(["ignore", "count_as_loss", "count_as_tie"]),
    persistenceThresholdPct: z.coerce.number().min(0).max(100),
  })
  .superRefine((v, ctx) => {
    if (v.periodMode === "days" && !v.maxDays) {
      ctx.addIssue({ code: "custom", path: ["maxDays"], message: "Informe o período máximo." });
    }
    if (v.periodMode === "range") {
      if (!v.startDate) ctx.addIssue({ code: "custom", path: ["startDate"], message: "Informe a data inicial." });
      if (!v.endDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Informe a data final." });
      if (v.startDate && v.endDate) {
        if (new Date(v.startDate) >= new Date(v.endDate)) {
          ctx.addIssue({ code: "custom", path: ["endDate"], message: "Data final deve ser depois da inicial." });
        } else if (resolveMaxDaysFromDateRange(new Date(v.startDate), new Date(v.endDate)) < MIN_STRUCTURAL_DAYS) {
          ctx.addIssue({
            code: "custom",
            path: ["endDate"],
            message: `O intervalo precisa ter pelo menos ${MIN_STRUCTURAL_DAYS} dias.`,
          });
        }
      }
    }
  });

type FormValues = z.input<typeof formSchema>;

export default function NewMultiPeriodAnalysisPage() {
  const router = useRouter();
  const currencyPairs = useCurrencyPairs();
  const createAnalysis = useCreateMultiPeriodAnalysis();

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      currencyPairIds: [],
      timeframe: "5m",
      periodMode: "days",
      maxDays: 100,
      startDate: "",
      endDate: "",
      startTime: "",
      endTime: "",
      timezone: "America/Sao_Paulo",
      weekdays: [],
      dojiTolerancePct: 0,
      dojiPolicy: "ignore",
      persistenceThresholdPct: 70,
    },
  });

  const periodMode = watch("periodMode");
  const maxDays = watch("maxDays");
  const startDate = watch("startDate");
  const endDate = watch("endDate");

  const structuralPreview =
    periodMode === "days"
      ? buildStructuralPreview(Number(maxDays))
      : startDate && endDate && new Date(startDate) < new Date(endDate)
        ? buildStructuralPreview(resolveMaxDaysFromDateRange(new Date(startDate), new Date(endDate)))
        : null;

  function onSubmit(values: FormValues) {
    const parsed = formSchema.parse(values);
    createAnalysis.mutate(
      {
        name: parsed.name,
        currencyPairIds: parsed.currencyPairIds,
        timeframe: parsed.timeframe,
        maxDays: parsed.periodMode === "days" ? parsed.maxDays : undefined,
        startDate: parsed.periodMode === "range" && parsed.startDate ? new Date(parsed.startDate).toISOString() : undefined,
        endDate: parsed.periodMode === "range" && parsed.endDate ? new Date(parsed.endDate).toISOString() : undefined,
        startTime: parsed.startTime || undefined,
        endTime: parsed.endTime || undefined,
        timezone: parsed.timezone,
        weekdays: parsed.weekdays.length > 0 ? parsed.weekdays : undefined,
        dojiTolerancePct: String(parsed.dojiTolerancePct),
        dojiPolicy: parsed.dojiPolicy,
        persistenceThresholdPct: String(parsed.persistenceThresholdPct),
      },
      {
        onSuccess: (result) => {
          if (result.analysis.status === "error") {
            toast.error(result.analysis.errorMessage ?? "Falha ao processar a análise.");
          } else {
            toast.success(
              result.processed ? `Análise concluída: ${result.patternsFound ?? 0} padrões encontrados.` : "Análise criada."
            );
          }
          router.push(`/analyses-plus/${result.analysis.id}`);
        },
        onError: (err) => {
          toast.error(err instanceof ApiClientError ? err.message : "Falha ao criar análise.");
        },
      }
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nova análise Plus</h1>
        <p className="text-muted-foreground">
          Avalia cada padrão (par + horário + direção) em várias janelas de tempo, encaixadas na mesma data de
          referência, combinando persistência, frequência, estabilidade, amostra e momentum num Confidence Score —
          em vez de simplesmente ordenar pelo maior percentual.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="name">Nome</FieldLabel>
                <Input id="name" placeholder="AUD/CAD 5m — Análise Plus" {...register("name")} />
                <FieldError errors={[errors.name]} />
              </Field>

              <Field data-invalid={!!errors.currencyPairIds}>
                <FieldLabel htmlFor="currencyPairIds">Pares de moedas</FieldLabel>
                {currencyPairs.isLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <Controller
                    control={control}
                    name="currencyPairIds"
                    render={({ field }) => (
                      <Select
                        multiple
                        items={Object.fromEntries((currencyPairs.data?.items ?? []).map((pair) => [pair.id, pair.symbol]))}
                        value={field.value}
                        onValueChange={(value) => field.onChange(value ?? [])}
                      >
                        <SelectTrigger id="currencyPairIds" className="w-full">
                          <SelectValue placeholder="Selecione um ou mais pares" />
                        </SelectTrigger>
                        <SelectContent>
                          {currencyPairs.data?.items.map((pair) => (
                            <SelectItem key={pair.id} value={pair.id}>
                              {pair.symbol} ({pair.candleCount.toLocaleString("pt-BR")} candles)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
                <FieldError errors={[errors.currencyPairIds]} />
              </Field>

              <Field>
                <FieldLabel htmlFor="timeframe">Timeframe</FieldLabel>
                <Controller
                  control={control}
                  name="timeframe"
                  render={({ field }) => (
                    <Select
                      items={Object.fromEntries(TIMEFRAMES.map((tf) => [tf, tf]))}
                      value={field.value}
                      onValueChange={(v) => v && field.onChange(v)}
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
                  )}
                />
              </Field>

              <Field>
                <FieldLabel>Período</FieldLabel>
                <Controller
                  control={control}
                  name="periodMode"
                  render={({ field }) => (
                    <Tabs value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                      <TabsList>
                        <TabsTrigger value="days">Últimos N dias (a partir de hoje)</TabsTrigger>
                        <TabsTrigger value="range">Período específico</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  )}
                />
                <FieldDescription>
                  {periodMode === "days"
                    ? "A janela rola com o tempo: reprocessar mais tarde recalcula tudo em cima de \"hoje\" de novo."
                    : "A janela fica fixa na data final escolhida — reprocessar não muda o período analisado."}
                </FieldDescription>
              </Field>

              {periodMode === "days" ? (
                <Field data-invalid={!!errors.maxDays}>
                  <FieldLabel htmlFor="maxDays">Período máximo (dias)</FieldLabel>
                  <Input id="maxDays" type="number" step={10} min={50} {...register("maxDays")} />
                  <FieldError errors={[errors.maxDays]} />
                </Field>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <Field data-invalid={!!errors.startDate}>
                    <FieldLabel htmlFor="startDate">Data inicial</FieldLabel>
                    <Input id="startDate" type="date" {...register("startDate")} />
                    <FieldError errors={[errors.startDate]} />
                  </Field>
                  <Field data-invalid={!!errors.endDate}>
                    <FieldLabel htmlFor="endDate">Data final</FieldLabel>
                    <Input id="endDate" type="date" {...register("endDate")} />
                    <FieldError errors={[errors.endDate]} />
                  </Field>
                </div>
              )}

              <FieldDescription>
                {structuralPreview
                  ? `Janelas estruturais geradas: ${structuralPreview.join("D, ")}D. Mais uma janela de momentum fixa em 40D (não entra na pontuação principal, só detecta fortalecimento/enfraquecimento/inversão).${
                      periodMode === "range"
                        ? ` O intervalo escolhido é arredondado pra baixo até o múltiplo de 10 mais próximo (usa os ${structuralPreview[0]} dias mais recentes dentro do período pedido).`
                        : ""
                    }`
                  : "Múltiplo de 10, mínimo 50 dias."}
              </FieldDescription>

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="startTime">Horário inicial (opcional)</FieldLabel>
                  <Input id="startTime" type="time" {...register("startTime")} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="endTime">Horário final (opcional)</FieldLabel>
                  <Input id="endTime" type="time" {...register("endTime")} />
                </Field>
              </div>

              <Field data-invalid={!!errors.timezone}>
                <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
                <Input id="timezone" placeholder="America/Sao_Paulo" {...register("timezone")} />
                <FieldError errors={[errors.timezone]} />
              </Field>

              <Field>
                <FieldLabel>Dias da semana (vazio = todos)</FieldLabel>
                <Controller
                  control={control}
                  name="weekdays"
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((day) => {
                        const active = field.value.includes(day.value);
                        return (
                          <Button
                            key={day.value}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "outline"}
                            onClick={() =>
                              field.onChange(
                                active ? field.value.filter((d: number) => d !== day.value) : [...field.value, day.value]
                              )
                            }
                          >
                            {day.label}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                />
              </Field>

              <FieldSet>
                <Field data-invalid={!!errors.persistenceThresholdPct}>
                  <FieldLabel htmlFor="persistenceThresholdPct">% mínimo de persistência</FieldLabel>
                  <Input
                    id="persistenceThresholdPct"
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    {...register("persistenceThresholdPct")}
                  />
                  <FieldDescription>
                    Percentual, na direção do padrão, que uma janela estrutural precisa atingir pra contar como
                    &quot;confirmada&quot; no cálculo de persistência (30 dos 100 pontos do Confidence Score).
                  </FieldDescription>
                  <FieldError errors={[errors.persistenceThresholdPct]} />
                </Field>
              </FieldSet>

              <Field>
                <FieldLabel htmlFor="dojiPolicy">Política de DOJI</FieldLabel>
                <Controller
                  control={control}
                  name="dojiPolicy"
                  render={({ field }) => (
                    <Select
                      items={{ ignore: "Ignorar", count_as_loss: "Contar como derrota", count_as_tie: "Contar como empate" }}
                      value={field.value}
                      onValueChange={(v) => v && field.onChange(v)}
                    >
                      <SelectTrigger id="dojiPolicy" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ignore">Ignorar</SelectItem>
                        <SelectItem value="count_as_loss">Contar como derrota</SelectItem>
                        <SelectItem value="count_as_tie">Contar como empate</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field data-invalid={!!errors.dojiTolerancePct}>
                <FieldLabel htmlFor="dojiTolerancePct">Tolerância de DOJI (%)</FieldLabel>
                <Input id="dojiTolerancePct" type="number" step="0.01" min={0} {...register("dojiTolerancePct")} />
                <FieldError errors={[errors.dojiTolerancePct]} />
              </Field>

              <Button type="submit" disabled={createAnalysis.isPending}>
                {createAnalysis.isPending ? "Processando..." : "Criar e executar análise"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** Só pra mostrar uma prévia das janelas ao usuário enquanto digita — a mesma regra de `buildStructuralWindowDays` do motor. */
function buildStructuralPreview(maxDays: number): number[] | null {
  if (!Number.isInteger(maxDays) || maxDays < 50 || maxDays % 10 !== 0) return null;
  const days: number[] = [];
  for (let d = maxDays; d >= 50; d -= 10) days.push(d);
  return days;
}

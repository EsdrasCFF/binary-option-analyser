"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useCurrencyPairs } from "@/lib/api-client/currency-pairs";
import { useCreateAnalysis } from "@/lib/api-client/analyses";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

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

const formSchema = z.object({
  name: z.string().min(1, "Informe um nome."),
  currencyPairIds: z.array(z.string()).min(1, "Selecione ao menos um par."),
  timeframe: z.string().min(1),
  historicalDays: z.coerce.number().int().min(1).max(3650),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  timezone: z.string().min(1, "Informe um timezone (ex: America/Sao_Paulo)."),
  minRepetitionPct: z.coerce.number().min(0).max(100),
  minValidDays: z.coerce.number().int().min(1).max(3650),
  topN: z.coerce.number().int().min(1).max(50),
  weekdays: z.array(z.number()),
  entryStrategy: z.enum(["same_direction", "contrarian"]),
  dojiTolerancePct: z.coerce.number().min(0),
  dojiPolicy: z.enum(["ignore", "count_as_loss", "count_as_tie"]),
});

type FormValues = z.input<typeof formSchema>;

export default function NewAnalysisPage() {
  const router = useRouter();
  const currencyPairs = useCurrencyPairs();
  const createAnalysis = useCreateAnalysis();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      currencyPairIds: [],
      timeframe: "5m",
      historicalDays: 30,
      startTime: "",
      endTime: "",
      timezone: "America/Sao_Paulo",
      minRepetitionPct: 60,
      minValidDays: 20,
      topN: 10,
      weekdays: [],
      entryStrategy: "same_direction",
      dojiTolerancePct: 0,
      dojiPolicy: "ignore",
    },
  });

  function onSubmit(values: FormValues) {
    const parsed = formSchema.parse(values);
    createAnalysis.mutate(
      {
        name: parsed.name,
        currencyPairIds: parsed.currencyPairIds,
        timeframe: parsed.timeframe,
        historicalDays: parsed.historicalDays,
        startTime: parsed.startTime || undefined,
        endTime: parsed.endTime || undefined,
        timezone: parsed.timezone,
        minRepetitionPct: String(parsed.minRepetitionPct),
        minValidDays: parsed.minValidDays,
        topN: parsed.topN,
        weekdays: parsed.weekdays.length > 0 ? parsed.weekdays : undefined,
        entryStrategy: parsed.entryStrategy,
        dojiTolerancePct: String(parsed.dojiTolerancePct),
        dojiPolicy: parsed.dojiPolicy,
      },
      {
        onSuccess: (result) => {
          toast.success(
            result.processed
              ? `Análise concluída: ${result.patternsFound ?? 0} padrões encontrados.`
              : "Análise criada."
          );
          router.push(`/analyses/${result.analysis.id}`);
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
        <h1 className="text-2xl font-semibold tracking-tight">Nova análise</h1>
        <p className="text-muted-foreground">
          Descobre os horários com maior repetição de direção (CALL/PUT) no período escolhido.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="name">Nome</FieldLabel>
                <Input id="name" placeholder="EUR/USD 5m — janeiro" {...register("name")} />
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
                        items={Object.fromEntries(
                          (currencyPairs.data?.items ?? []).map((pair) => [pair.id, pair.symbol])
                        )}
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
                <FieldDescription>
                  Nenhum par importado ainda? Vá em <em>Importar CSV</em> ou <em>Importar Yahoo Finance</em> primeiro.
                </FieldDescription>
                <FieldError errors={[errors.currencyPairIds]} />
              </Field>

              <div className="grid grid-cols-2 gap-4">
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
                <Field data-invalid={!!errors.historicalDays}>
                  <FieldLabel htmlFor="historicalDays">Dias de histórico</FieldLabel>
                  <Input id="historicalDays" type="number" min={1} {...register("historicalDays")} />
                  <FieldError errors={[errors.historicalDays]} />
                </Field>
              </div>

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
                                active
                                  ? field.value.filter((d: number) => d !== day.value)
                                  : [...field.value, day.value]
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
                <div className="grid grid-cols-3 gap-4">
                  <Field data-invalid={!!errors.minRepetitionPct}>
                    <FieldLabel htmlFor="minRepetitionPct">% mínimo</FieldLabel>
                    <Input
                      id="minRepetitionPct"
                      type="number"
                      step="0.1"
                      min={0}
                      max={100}
                      {...register("minRepetitionPct")}
                    />
                    <FieldError errors={[errors.minRepetitionPct]} />
                  </Field>
                  <Field data-invalid={!!errors.minValidDays}>
                    <FieldLabel htmlFor="minValidDays">Dias válidos mín.</FieldLabel>
                    <Input id="minValidDays" type="number" min={1} {...register("minValidDays")} />
                    <FieldError errors={[errors.minValidDays]} />
                  </Field>
                  <Field data-invalid={!!errors.topN}>
                    <FieldLabel htmlFor="topN">Top N</FieldLabel>
                    <Input id="topN" type="number" min={1} max={50} {...register("topN")} />
                    <FieldError errors={[errors.topN]} />
                  </Field>
                </div>
                <FieldDescription>
                  Mantém só os N horários com maior repetição, entre os que passarem do % mínimo.
                </FieldDescription>
              </FieldSet>

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="entryStrategy">Estratégia de entrada</FieldLabel>
                  <Controller
                    control={control}
                    name="entryStrategy"
                    render={({ field }) => (
                      <Select
                        items={{ same_direction: "Mesma direção", contrarian: "Contrária" }}
                        value={field.value}
                        onValueChange={(v) => v && field.onChange(v)}
                      >
                        <SelectTrigger id="entryStrategy" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="same_direction">Mesma direção</SelectItem>
                          <SelectItem value="contrarian">Contrária</SelectItem>
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
                          ignore: "Ignorar",
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
                          <SelectItem value="ignore">Ignorar</SelectItem>
                          <SelectItem value="count_as_loss">Contar como derrota</SelectItem>
                          <SelectItem value="count_as_tie">Contar como empate</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>

              <Field data-invalid={!!errors.dojiTolerancePct}>
                <FieldLabel htmlFor="dojiTolerancePct">Tolerância de DOJI (%)</FieldLabel>
                <Input
                  id="dojiTolerancePct"
                  type="number"
                  step="0.01"
                  min={0}
                  {...register("dojiTolerancePct")}
                />
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

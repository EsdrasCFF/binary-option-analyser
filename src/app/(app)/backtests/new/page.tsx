"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useCreateBacktest } from "@/lib/api-client/backtests";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
    martingaleLevels: z.coerce.number().int().min(0).max(5),
    maxExposureLimit: z.coerce.number().optional(),
    dailyLossLimit: z.coerce.number().optional(),
    maxOperationsPerDay: z.coerce.number().int().optional(),
    dojiPolicy: z.enum(["ignore", "count_as_loss", "count_as_tie"]),
    oneEntryPerTimeSlot: z.boolean(),
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

export default function NewBacktestPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const patternResultIds = (searchParams.get("patternResultIds") ?? "").split(",").filter(Boolean);
  const createBacktest = useCreateBacktest();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      entryStrategy: "same_direction",
      payoutPct: 85,
      initialBankroll: 1000,
      initialEntry: 5,
      minProfit: 1,
      martingaleLevels: 2,
      dojiPolicy: "count_as_loss",
      oneEntryPerTimeSlot: true,
      periodStart: "",
      periodEnd: "",
    },
  });

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
        martingaleLevels: parsed.martingaleLevels,
        maxExposureLimit: parsed.maxExposureLimit ? String(parsed.maxExposureLimit) : undefined,
        dailyLossLimit: parsed.dailyLossLimit ? String(parsed.dailyLossLimit) : undefined,
        maxOperationsPerDay: parsed.maxOperationsPerDay,
        dojiPolicy: parsed.dojiPolicy,
        oneEntryPerTimeSlot: parsed.oneEntryPerTimeSlot,
        periodStart: new Date(parsed.periodStart).toISOString(),
        periodEnd: new Date(parsed.periodEnd).toISOString(),
      },
      {
        onSuccess: (result) => {
          toast.success(
            result.processed
              ? `Backtest concluído: ${result.totalOperations ?? 0} operações.`
              : "Backtest criado."
          );
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
        <p className="text-muted-foreground">{patternResultIds.length} padrão(ões) selecionado(s).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parâmetros</CardTitle>
          <CardDescription>Martingale calculado a cada operação, contra a banca atual.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="periodStart">Início do período</FieldLabel>
                  <Input id="periodStart" type="date" {...register("periodStart")} />
                  <FieldError errors={[errors.periodStart]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="periodEnd">Fim do período</FieldLabel>
                  <Input id="periodEnd" type="date" {...register("periodEnd")} />
                  <FieldError errors={[errors.periodEnd]} />
                </Field>
              </div>

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

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="minProfit">Lucro mínimo</FieldLabel>
                  <Input id="minProfit" type="number" step="0.01" {...register("minProfit")} />
                  <FieldError errors={[errors.minProfit]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="martingaleLevels">Níveis de Martingale</FieldLabel>
                  <Input id="martingaleLevels" type="number" min={0} max={5} {...register("martingaleLevels")} />
                  <FieldError errors={[errors.martingaleLevels]} />
                </Field>
              </div>

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

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="maxExposureLimit">Limite de exposição (opcional)</FieldLabel>
                  <Input id="maxExposureLimit" type="number" step="0.01" {...register("maxExposureLimit")} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="dailyLossLimit">Limite de perda diária (opcional)</FieldLabel>
                  <Input id="dailyLossLimit" type="number" step="0.01" {...register("dailyLossLimit")} />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="maxOperationsPerDay">Máx. de operações por dia (opcional)</FieldLabel>
                <Input id="maxOperationsPerDay" type="number" min={1} {...register("maxOperationsPerDay")} />
              </Field>

              <Field orientation="horizontal">
                <Controller
                  control={control}
                  name="oneEntryPerTimeSlot"
                  render={({ field }) => (
                    <Checkbox
                      id="oneEntryPerTimeSlot"
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  )}
                />
                <FieldLabel htmlFor="oneEntryPerTimeSlot" className="font-normal">
                  No máximo uma entrada por horário/dia
                </FieldLabel>
              </Field>
              <FieldDescription>
                Protege contra o mesmo horário local ocorrer duas vezes no dia (ex: troca de horário de verão).
              </FieldDescription>

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

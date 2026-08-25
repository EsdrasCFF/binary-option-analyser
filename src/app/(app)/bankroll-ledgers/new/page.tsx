"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useCreateBankrollLedger } from "@/lib/api-client/bankroll-ledgers";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function NewBankrollLedgerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const analysisId = searchParams.get("analysisId") ?? "";

  const [name, setName] = useState("");
  const [initialBankroll, setInitialBankroll] = useState("1000");
  const [error, setError] = useState<string | null>(null);
  const createLedger = useCreateBankrollLedger();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!(Number(initialBankroll) > 0)) {
      setError("Informe uma banca inicial maior que zero.");
      return;
    }
    createLedger.mutate(
      {
        analysisId,
        name: name.trim() || undefined,
        initialBankroll,
      },
      {
        onSuccess: (ledger) => {
          toast.success("Gerenciamento criado.");
          router.push(`/bankroll-ledgers/${ledger.id}`);
        },
        onError: (err) => {
          toast.error(err instanceof ApiClientError ? err.message : "Falha ao criar gerenciamento.");
        },
      }
    );
  }

  if (!analysisId) {
    return (
      <div className="max-w-2xl">
        <Alert>
          <AlertTriangle />
          <AlertTitle>Nenhuma análise informada</AlertTitle>
          <AlertDescription>
            Abra uma{" "}
            <Link href="/analyses" className="underline underline-offset-4">
              análise
            </Link>{" "}
            e clique em &quot;Aplicar gerenciamento&quot;.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo gerenciamento de banca</h1>
        <p className="text-muted-foreground">
          Todos os horários da análise vão ficar disponíveis pra escolher em cada linha da planilha.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parâmetros</CardTitle>
          <CardDescription>
            Uma planilha manual: você registra as operações que fez (horário, %, entrada e o resultado), e o sistema
            calcula o lucro/prejuízo de cada linha e o saldo acumulado — sem simular nada automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Nome (opcional)</FieldLabel>
                <Input
                  id="name"
                  maxLength={60}
                  placeholder="Ex: EUR/USD manhã — gerenciamento real"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>

              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="initialBankroll">Banca inicial</FieldLabel>
                <Input
                  id="initialBankroll"
                  type="number"
                  step="0.01"
                  min={0.01}
                  value={initialBankroll}
                  onChange={(e) => setInitialBankroll(e.target.value)}
                />
                <FieldError errors={error ? [{ message: error }] : []} />
              </Field>

              <Button type="submit" disabled={createLedger.isPending}>
                {createLedger.isPending ? "Criando..." : "Criar gerenciamento"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

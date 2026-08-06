"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useImportCsv } from "@/lib/api-client/candles";
import { ApiClientError } from "@/lib/api-client/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2 } from "lucide-react";

export default function ImportCsvPage() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const importCsv = useImportCsv();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error("Selecione um arquivo CSV.");
      return;
    }
    importCsv.mutate(
      { file, source: source || undefined },
      {
        onSuccess: (result) => {
          toast.success(`${result.importedRows} candles importados.`);
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
        <h1 className="text-2xl font-semibold tracking-tight">Importar candles (CSV)</h1>
        <p className="text-muted-foreground">
          Cabeçalho obrigatório: symbol, timeframe, open_time, close_time, open, high, low, close, volume.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Arquivo</CardTitle>
          <CardDescription>Reimportar o mesmo arquivo não duplica candles.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="file">Arquivo CSV</FieldLabel>
                <Input
                  id="file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="source">Rótulo da origem (opcional)</FieldLabel>
                <Input
                  id="source"
                  placeholder="csv_import"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
                <FieldDescription>Gravado em candles.source. Default: &quot;csv_import&quot;.</FieldDescription>
              </Field>
              <Button type="submit" disabled={importCsv.isPending}>
                {importCsv.isPending ? "Importando..." : "Importar"}
              </Button>
            </FieldGroup>
          </form>

          {importCsv.data && (
            <Alert className="mt-6">
              <CheckCircle2 />
              <AlertTitle>Importação concluída</AlertTitle>
              <AlertDescription>
                {importCsv.data.importedRows} novos candles, {importCsv.data.duplicateRows} já existiam. Pares:{" "}
                {importCsv.data.symbols.join(", ")}. Timeframes: {importCsv.data.timeframes.join(", ")}.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

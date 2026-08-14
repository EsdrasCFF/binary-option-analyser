"use client";

import { useCurrencyPairs } from "@/lib/api-client/currency-pairs";
import { useDataProviders } from "@/lib/api-client/data-providers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDateTime } from "@/lib/format";

export default function DataProvidersPage() {
  const currencyPairs = useCurrencyPairs();
  const dataProviders = useDataProviders();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pares e fontes de dados</h1>
        <p className="text-muted-foreground">
          Pares de moedas e fontes de importação já usados no sistema. Criados automaticamente pelas telas de
          importação.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pares de moedas</CardTitle>
          <CardDescription>
            Cobertura de candles por par e timeframe — um mesmo par pode ter janelas de dados diferentes por
            timeframe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currencyPairs.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : currencyPairs.data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum par importado ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Par</TableHead>
                  <TableHead>Timeframe</TableHead>
                  <TableHead className="text-right">Candles</TableHead>
                  <TableHead>Primeiro candle</TableHead>
                  <TableHead>Último candle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currencyPairs.data?.items.flatMap((pair) =>
                  pair.timeframes.length === 0 ? (
                    <TableRow key={pair.id}>
                      <TableCell className="font-medium">{pair.symbol}</TableCell>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        Nenhum candle importado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pair.timeframes.map((tf, i) => (
                      <TableRow key={`${pair.id}-${tf.timeframe}`}>
                        <TableCell className="font-medium">{i === 0 ? pair.symbol : ""}</TableCell>
                        <TableCell>{tf.timeframe}</TableCell>
                        <TableCell className="text-right">{tf.candleCount.toLocaleString("pt-BR")}</TableCell>
                        <TableCell>{formatDate(tf.firstCandle)}</TableCell>
                        <TableCell>{formatDate(tf.lastCandle)}</TableCell>
                      </TableRow>
                    ))
                  )
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fontes de dados</CardTitle>
          <CardDescription>Provedores de importação (CSV / API).</CardDescription>
        </CardHeader>
        <CardContent>
          {dataProviders.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : dataProviders.data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma fonte criada ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Criado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dataProviders.data?.items.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell className="font-medium">{provider.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{provider.type.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(provider.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

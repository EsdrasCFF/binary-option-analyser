/**
 * POST /api/candles/import-yahoo
 *
 * Importa candles reais direto do Yahoo Finance (sem precisar de CSV),
 * usando o endpoint não-oficial de gráfico do Yahoo
 * (ver src/lib/external/yahoo-finance.ts para as limitações da fonte).
 *
 * body:
 * {
 *   "symbols": ["EUR/USD", "GBP/USD"],
 *   "timeframe": "5m",
 *   "from": "2026-06-01T00:00:00Z",   // opcional — default: todo o histórico disponível
 *   "to": "2026-08-01T00:00:00Z",     // opcional — default: agora
 *   "dataProviderId": "<uuid>",        // opcional
 *   "source": "yahoo_finance"          // opcional — default "yahoo_finance"
 * }
 *
 * Diferente da importação por CSV, aqui não existe "paginar para trazer mais
 * histórico": candles intraday antigos simplesmente não existem na fonte além
 * da janela móvel de cada intervalo (8 dias para 1m, 60 para 5m/15m/30m, etc).
 * Por isso a resposta inclui `windows[].truncated` e um aviso explícito
 * quando o período pedido foi cortado — nunca falha silenciosamente.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  YahooFinanceCandleProvider,
  isSupportedYahooInterval,
  pairToYahooSymbol,
} from "@/lib/external/yahoo-finance";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, isoDateTimeString, parseJsonBody, uuidString } from "@/lib/api/http";
import { persistImportedCandles, resolveDataProviderId } from "@/lib/db/persist-candles";

const bodySchema = z.object({
  symbols: z.array(z.string().min(1)).min(1).max(20),
  timeframe: z.string().min(1).max(10),
  from: isoDateTimeString.optional(),
  to: isoDateTimeString.optional(),
  dataProviderId: uuidString.optional(),
  source: z.string().min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId(req);
    const body = await parseJsonBody(req, bodySchema);

    if (!isSupportedYahooInterval(body.timeframe)) {
      throw new ApiError(
        `Timeframe "${body.timeframe}" não é suportado pelo Yahoo Finance (ex: 1m, 5m, 15m, 30m, 1h, 1d).`,
        400
      );
    }

    // valida o formato dos símbolos antes de gastar uma chamada de rede
    for (const symbol of body.symbols) {
      try {
        pairToYahooSymbol(symbol);
      } catch (e) {
        throw new ApiError((e as Error).message, 400);
      }
    }

    const to = body.to ? new Date(body.to) : new Date();
    const from = body.from ? new Date(body.from) : new Date(0);
    if (from.getTime() >= to.getTime()) {
      throw new ApiError("from deve ser anterior a to.", 400);
    }

    const dataProviderId = await resolveDataProviderId(
      userId,
      body.dataProviderId,
      "api",
      "Yahoo Finance"
    );

    const provider = new YahooFinanceCandleProvider({
      symbols: body.symbols,
      timeframe: body.timeframe,
      from,
      to,
    });

    let candles;
    try {
      candles = await provider.loadCandles();
    } catch (e) {
      // falha da fonte externa (símbolo inexistente, indisponibilidade, etc): 502, não 500
      throw new ApiError(
        e instanceof Error ? e.message : "Falha ao buscar dados no Yahoo Finance.",
        502
      );
    }

    if (body.source) {
      candles = candles.map((c) => ({ ...c, source: body.source! }));
    }

    const result = await persistImportedCandles({ userId, dataProviderId, candles });

    const windows = provider.lastImportSummary.map((s) => ({
      symbol: s.symbol,
      requestedFrom: from.toISOString(),
      effectiveFrom: s.window.from.toISOString(),
      to: s.window.to.toISOString(),
      truncated: s.window.truncated,
      maxLookbackDays: s.window.maxLookbackDays,
      barsLoaded: s.barsLoaded,
    }));
    const truncated = windows.filter((w) => w.truncated);

    return NextResponse.json(
      {
        ...result,
        windows,
        warning:
          truncated.length > 0
            ? `O Yahoo Finance só mantém histórico intraday recente para "${body.timeframe}" (máx. ${truncated[0].maxLookbackDays} dia(s)). A janela foi ajustada para: ${truncated.map((w) => w.symbol).join(", ")}.`
            : null,
      },
      { status: 201 }
    );
  });
}

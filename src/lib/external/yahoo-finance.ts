/**
 * Cliente para o endpoint de gráfico do Yahoo Finance (chart API).
 *
 * ⚠️ Endpoint NÃO OFICIAL: não há documentação pública nem SLA — o Yahoo pode
 * mudar o formato ou bloquear sem aviso. Adequado para desenvolvimento e
 * análise pessoal; não é uma garantia de disponibilidade para produção.
 *
 * Limitação importante, confirmada empiricamente contra o endpoint real
 * (query1.finance.yahoo.com/v8/finance/chart), e não documentada oficialmente:
 * candles intraday só existem para uma JANELA MÓVEL a partir de "agora" — não
 * é uma questão de paginação (não existe histórico mais antigo para buscar):
 *
 *   1m            -> últimos 8 dias
 *   2m/5m/15m/30m/90m -> últimos 60 dias
 *   60m/1h        -> ~730 dias (não confirmado empiricamente; Yahoo não retorna
 *                    erro de range para este intervalo nos testes feitos)
 *   1d ou maior   -> sem limite prático conhecido (testado com 2 anos)
 *
 * Para a análise "padrão por horário" deste app (que normalmente precisa de
 * 20-30+ dias de amostra), 5m/15m/1h têm folga; 1m fica bem apertado (8 dias).
 */
import { Decimal } from "decimal.js";
import { Candle, makeCandle } from "@/lib/core/candle-classifier";
import { CandleDataProvider } from "@/lib/core/data-provider";

/** Janela móvel máxima (dias a partir de "agora") por intervalo intraday. `null` = sem limite conhecido. */
const MAX_LOOKBACK_DAYS: Record<string, number | null> = {
  "1m": 8,
  "2m": 60,
  "5m": 60,
  "15m": 60,
  "30m": 60,
  "90m": 60,
  "60m": 730,
  "1h": 730,
  "1d": null,
  "5d": null,
  "1wk": null,
  "1mo": null,
  "3mo": null,
};

export function isSupportedYahooInterval(timeframe: string): boolean {
  return timeframe in MAX_LOOKBACK_DAYS;
}

export interface ImportWindow {
  from: Date;
  to: Date;
  /** true quando `from` foi ajustado para dentro do limite de histórico disponível. */
  truncated: boolean;
  maxLookbackDays: number | null;
}

/**
 * Ajusta a janela solicitada para dentro do que o Yahoo realmente disponibiliza.
 * Não é "paginação": dados intraday mais antigos que o limite não existem na
 * fonte, então a única opção correta é avisar o chamador que a janela foi
 * cortada — nunca falhar silenciosamente nem devolver menos dados sem dizer.
 */
export function resolveImportWindow(
  timeframe: string,
  requestedFrom: Date,
  requestedTo: Date,
  now: Date
): ImportWindow {
  const maxLookbackDays = MAX_LOOKBACK_DAYS[timeframe] ?? null;
  if (maxLookbackDays === null) {
    return { from: requestedFrom, to: requestedTo, truncated: false, maxLookbackDays: null };
  }

  const earliestAvailable = new Date(now.getTime() - maxLookbackDays * 24 * 60 * 60 * 1000);
  if (requestedFrom.getTime() >= earliestAvailable.getTime()) {
    return { from: requestedFrom, to: requestedTo, truncated: false, maxLookbackDays };
  }
  return { from: earliestAvailable, to: requestedTo, truncated: true, maxLookbackDays };
}

/** Converte "EUR/USD" -> "EURUSD=X" (formato de ticker de forex do Yahoo). */
export function pairToYahooSymbol(pair: string): string {
  const compact = pair.trim().toUpperCase().replace(/[-_/]/g, "");
  if (compact.length !== 6) {
    throw new Error(`Símbolo de par de moedas inválido para o Yahoo Finance: "${pair}".`);
  }
  return `${compact}=X`;
}

/** Converte "EURUSD=X" -> "EUR/USD". */
export function yahooSymbolToPair(yahooSymbol: string): string {
  const compact = yahooSymbol.trim().toUpperCase().replace(/=X$/, "");
  if (compact.length !== 6) {
    throw new Error(`Ticker do Yahoo Finance inesperado: "${yahooSymbol}".`);
  }
  return `${compact.slice(0, 3)}/${compact.slice(3)}`;
}

interface YahooChartResult {
  meta: { symbol: string; instrumentType: string };
  timestamp?: number[];
  indicators: {
    quote: Array<{
      open: Array<number | null>;
      high: Array<number | null>;
      low: Array<number | null>;
      close: Array<number | null>;
      volume: Array<number | null>;
    }>;
  };
}

interface YahooChartResponse {
  chart: {
    result: YahooChartResult[] | null;
    error: { code: string; description: string } | null;
  };
}

export interface YahooBar {
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export type FetchImpl = typeof fetch;

/**
 * Busca as barras de um único símbolo no intervalo [from, to]. Não faz
 * retry/paginação: o chamador decide a janela (via `resolveImportWindow`).
 *
 * `fetchImpl` é injetável para permitir testar o parsing sem rede real.
 */
export async function fetchYahooBars(
  yahooSymbol: string,
  timeframe: string,
  from: Date,
  to: Date,
  fetchImpl: FetchImpl = fetch
): Promise<YahooBar[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}`);
  url.searchParams.set("interval", timeframe);
  url.searchParams.set("period1", String(Math.floor(from.getTime() / 1000)));
  url.searchParams.set("period2", String(Math.floor(to.getTime() / 1000)));

  const response = await fetchImpl(url.toString(), {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; bo-analytics/1.0)" },
  });
  if (!response.ok) {
    throw new Error(`Yahoo Finance respondeu ${response.status} para "${yahooSymbol}".`);
  }

  const body = (await response.json()) as YahooChartResponse;
  if (body.chart.error) {
    throw new Error(
      `Yahoo Finance: ${body.chart.error.code} — ${body.chart.error.description} (símbolo "${yahooSymbol}").`
    );
  }
  const result = body.chart.result?.[0];
  if (!result || !result.timestamp) {
    throw new Error(`Yahoo Finance não retornou dados para "${yahooSymbol}".`);
  }

  const quote = result.indicators.quote[0];
  const bars: YahooBar[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    // gaps de mercado (fins de semana, feriados) vêm como null nos campos — descarta a linha inteira
    if (quote.open[i] === null || quote.high[i] === null || quote.low[i] === null || quote.close[i] === null) {
      continue;
    }
    bars.push({
      openTime: new Date(result.timestamp[i] * 1000),
      open: quote.open[i]!,
      high: quote.high[i]!,
      low: quote.low[i]!,
      close: quote.close[i]!,
      // forex à vista não tem volume real na fonte; 0 não é informação, é ausência
      volume: quote.volume[i] ? quote.volume[i] : null,
    });
  }
  return bars;
}

const TIMEFRAME_DURATION_MS: Record<string, number> = {
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "90m": 90 * 60_000,
  "60m": 60 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export interface YahooFinanceProviderOptions {
  symbols: string[]; // formato "EUR/USD"
  timeframe: string;
  from: Date;
  to: Date;
  fetchImpl?: FetchImpl;
}

export interface YahooImportSummary {
  symbol: string;
  window: ImportWindow;
  barsLoaded: number;
}

/**
 * Implementa `CandleDataProvider` buscando candles reais no Yahoo Finance.
 * Mesma interface do `CSVCandleProvider`/`DbCandleProvider`: o motor de
 * análise não sabe (nem precisa saber) de onde os candles vieram.
 */
export class YahooFinanceCandleProvider implements CandleDataProvider {
  readonly lastImportSummary: YahooImportSummary[] = [];

  constructor(private readonly options: YahooFinanceProviderOptions) {
    if (!isSupportedYahooInterval(options.timeframe)) {
      throw new Error(
        `Timeframe "${options.timeframe}" não é suportado pelo Yahoo Finance. Use um de: ${Object.keys(MAX_LOOKBACK_DAYS).join(", ")}.`
      );
    }
  }

  async loadCandles(): Promise<Candle[]> {
    const { symbols, timeframe, from, to, fetchImpl } = this.options;
    const durationMs = TIMEFRAME_DURATION_MS[timeframe] ?? 60_000;
    const now = new Date();

    const candles: Candle[] = [];
    for (const symbol of symbols) {
      const yahooSymbol = pairToYahooSymbol(symbol);
      const window = resolveImportWindow(timeframe, from, to, now);
      const bars = await fetchYahooBars(yahooSymbol, timeframe, window.from, window.to, fetchImpl);

      this.lastImportSummary.push({ symbol, window, barsLoaded: bars.length });

      for (const bar of bars) {
        candles.push(
          makeCandle({
            symbol,
            timeframe,
            openTime: bar.openTime,
            closeTime: new Date(bar.openTime.getTime() + durationMs),
            open: new Decimal(bar.open),
            high: new Decimal(bar.high),
            low: new Decimal(bar.low),
            close: new Decimal(bar.close),
            volume: bar.volume === null ? null : new Decimal(bar.volume),
            source: "yahoo_finance",
          })
        );
      }
    }

    candles.sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
    return candles;
  }
}

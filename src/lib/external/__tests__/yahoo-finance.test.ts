import { describe, it, expect, vi } from "vitest";
import {
  YahooFinanceCandleProvider,
  isSupportedYahooInterval,
  pairToYahooSymbol,
  resolveImportWindow,
  yahooSymbolToPair,
} from "../yahoo-finance";

function fakeChartResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Corpo no mesmo formato observado na inspeção real do endpoint do Yahoo. */
function okChartBody(symbol: string, timestamps: number[], closes: (number | null)[]) {
  return {
    chart: {
      error: null,
      result: [
        {
          meta: { symbol, instrumentType: "CURRENCY" },
          timestamp: timestamps,
          indicators: {
            quote: [
              {
                open: closes.map((c) => (c === null ? null : c - 0.0001)),
                high: closes.map((c) => (c === null ? null : c + 0.0002)),
                low: closes.map((c) => (c === null ? null : c - 0.0002)),
                close: closes,
                volume: closes.map(() => 0),
              },
            ],
          },
        },
      ],
    },
  };
}

describe("pairToYahooSymbol / yahooSymbolToPair", () => {
  it("converte nos dois sentidos", () => {
    expect(pairToYahooSymbol("EUR/USD")).toBe("EURUSD=X");
    expect(yahooSymbolToPair("EURUSD=X")).toBe("EUR/USD");
  });

  it("lança erro para símbolo em formato inválido", () => {
    expect(() => pairToYahooSymbol("EURUSD")).not.toThrow(); // 6 chars sem barra: aceito
    expect(() => pairToYahooSymbol("EU/USD")).toThrow();
  });
});

describe("isSupportedYahooInterval", () => {
  it("aceita os timeframes usados pela app e rejeita os demais", () => {
    expect(isSupportedYahooInterval("5m")).toBe(true);
    expect(isSupportedYahooInterval("1h")).toBe(true);
    expect(isSupportedYahooInterval("1d")).toBe(true);
    expect(isSupportedYahooInterval("7m")).toBe(false);
  });
});

describe("resolveImportWindow", () => {
  const now = new Date("2026-08-04T00:00:00Z");

  it("trunca 1m para os últimos 8 dias quando a janela pedida é maior", () => {
    const requestedFrom = new Date("2026-07-01T00:00:00Z"); // 34 dias atrás
    const window = resolveImportWindow("1m", requestedFrom, now, now);
    expect(window.truncated).toBe(true);
    expect(window.maxLookbackDays).toBe(8);
    expect(window.from.toISOString()).toBe(new Date(now.getTime() - 8 * 86400000).toISOString());
  });

  it("não trunca quando a janela pedida já está dentro do limite", () => {
    const requestedFrom = new Date(now.getTime() - 3 * 86400000);
    const window = resolveImportWindow("1m", requestedFrom, now, now);
    expect(window.truncated).toBe(false);
    expect(window.from).toBe(requestedFrom);
  });

  it("não trunca timeframes diários (sem limite conhecido)", () => {
    const requestedFrom = new Date("2000-01-01T00:00:00Z");
    const window = resolveImportWindow("1d", requestedFrom, now, now);
    expect(window.truncated).toBe(false);
    expect(window.maxLookbackDays).toBeNull();
  });
});

describe("YahooFinanceCandleProvider", () => {
  it("converte a resposta do Yahoo em Candle[], ignorando gaps (close null)", async () => {
    const t0 = Math.floor(new Date("2026-08-01T12:00:00Z").getTime() / 1000);
    const timestamps = [t0, t0 + 300, t0 + 600];
    const closes = [1.101, null, 1.099]; // segundo candle é um gap de mercado
    const fetchImpl = vi.fn(async () => fakeChartResponse(okChartBody("EURUSD=X", timestamps, closes)));

    const provider = new YahooFinanceCandleProvider({
      symbols: ["EUR/USD"],
      timeframe: "5m",
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-01T23:59:59Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const candles = await provider.loadCandles();

    expect(candles).toHaveLength(2); // o gap foi descartado
    expect(candles[0].symbol).toBe("EUR/USD");
    expect(candles[0].timeframe).toBe("5m");
    expect(candles[0].source).toBe("yahoo_finance");
    expect(candles[0].openTime.toISOString()).toBe("2026-08-01T12:00:00.000Z");
    expect(candles[0].closeTime.toISOString()).toBe("2026-08-01T12:05:00.000Z");
    expect(candles[0].close.toString()).toBe("1.101");
    expect(candles[0].volume).toBeNull(); // volume 0 do forex vira null (não é informação real)

    expect(provider.lastImportSummary).toHaveLength(1);
    expect(provider.lastImportSummary[0].barsLoaded).toBe(2);
  });

  it("propaga o erro do Yahoo com mensagem clara (ex: símbolo inexistente)", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeChartResponse({ chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } })
    );

    const provider = new YahooFinanceCandleProvider({
      symbols: ["ZZZ/ZZZ"],
      timeframe: "5m",
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-02T00:00:00Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.loadCandles()).rejects.toThrow(/Not Found/);
  });

  it("rejeita timeframe não suportado sem fazer nenhuma chamada de rede", () => {
    const fetchImpl = vi.fn();
    expect(
      () =>
        new YahooFinanceCandleProvider({
          symbols: ["EUR/USD"],
          timeframe: "7m",
          from: new Date(),
          to: new Date(),
          fetchImpl: fetchImpl as unknown as typeof fetch,
        })
    ).toThrow(/não é suportado/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("registra a janela truncada no lastImportSummary quando o período pedido excede o disponível", async () => {
    const fetchImpl = vi.fn(async () => fakeChartResponse(okChartBody("EURUSD=X", [], [])));

    const provider = new YahooFinanceCandleProvider({
      symbols: ["EUR/USD"],
      timeframe: "1m",
      from: new Date("2000-01-01T00:00:00Z"),
      to: new Date(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.loadCandles();

    expect(provider.lastImportSummary[0].window.truncated).toBe(true);
    expect(provider.lastImportSummary[0].window.maxLookbackDays).toBe(8);
  });
});

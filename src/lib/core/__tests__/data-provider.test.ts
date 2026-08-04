import { describe, it, expect } from "vitest";
import { CSVCandleProvider, detectMissingCandles } from "../data-provider";

const HEADER = "symbol,timeframe,open_time,close_time,open,high,low,close,volume";

function row(
  symbol: string,
  openTime: string,
  closeTime: string,
  open: string,
  close: string
) {
  const high = Math.max(Number(open), Number(close)) + 0.0002;
  const low = Math.min(Number(open), Number(close)) - 0.0002;
  return `${symbol},5m,${openTime},${closeTime},${open},${high},${low},${close},1000`;
}

describe("CSVCandleProvider", () => {
  it("carrega candles, normaliza símbolo e ordena por open_time", async () => {
    const csv = [
      HEADER,
      row("eurusd", "2026-01-02T12:00:00Z", "2026-01-02T12:05:00Z", "1.1000", "1.1010"),
      row("EUR/USD", "2026-01-01T12:00:00Z", "2026-01-01T12:05:00Z", "1.1010", "1.1000"),
    ].join("\n");

    const provider = new CSVCandleProvider(csv);
    const candles = await provider.loadCandles();

    expect(candles).toHaveLength(2);
    expect(candles[0].symbol).toBe("EUR/USD");
    expect(candles.every((c) => c.symbol === "EUR/USD")).toBe(true);
    // ordenado: dia 1 antes do dia 2
    expect(candles[0].openTime.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("detecta e ignora duplicados (mesmo symbol+timeframe+open_time)", async () => {
    const csv = [
      HEADER,
      row("EURUSD", "2026-01-01T12:00:00Z", "2026-01-01T12:05:00Z", "1.1000", "1.1010"),
      row("EURUSD", "2026-01-01T12:00:00Z", "2026-01-01T12:05:00Z", "1.1000", "1.1010"),
    ].join("\n");

    const provider = new CSVCandleProvider(csv);
    const candles = await provider.loadCandles();
    expect(candles).toHaveLength(1);
  });

  it("lança erro se faltar coluna obrigatória", async () => {
    const csv = "symbol,timeframe,open_time\nEURUSD,5m,2026-01-01T12:00:00Z";
    const provider = new CSVCandleProvider(csv);
    await expect(provider.loadCandles()).rejects.toThrow(/Colunas obrigatórias ausentes/);
  });

  it("assume UTC quando a data não tem timezone e assumeUtcIfNaive=true", async () => {
    const csv = [
      HEADER,
      row("EURUSD", "2026-01-01T12:00:00", "2026-01-01T12:05:00", "1.1000", "1.1010"),
    ].join("\n");
    const provider = new CSVCandleProvider(csv, { assumeUtcIfNaive: true });
    const candles = await provider.loadCandles();
    expect(candles[0].openTime.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });
});

describe("detectMissingCandles", () => {
  it("detecta gaps maiores que o intervalo esperado", async () => {
    const csv = [
      HEADER,
      row("EURUSD", "2026-01-01T12:00:00Z", "2026-01-01T12:05:00Z", "1.10", "1.11"),
      row("EURUSD", "2026-01-01T12:05:00Z", "2026-01-01T12:10:00Z", "1.11", "1.12"),
      // gap aqui: pula direto para 12:30 (deveria ter 12:10, 12:15, 12:20, 12:25)
      row("EURUSD", "2026-01-01T12:30:00Z", "2026-01-01T12:35:00Z", "1.12", "1.13"),
    ].join("\n");
    const provider = new CSVCandleProvider(csv);
    const candles = await provider.loadCandles();
    const gaps = detectMissingCandles(candles, 5);
    expect(gaps).toHaveLength(1);
  });

  it("não reporta gap quando o intervalo é regular", async () => {
    const csv = [
      HEADER,
      row("EURUSD", "2026-01-01T12:00:00Z", "2026-01-01T12:05:00Z", "1.10", "1.11"),
      row("EURUSD", "2026-01-01T12:05:00Z", "2026-01-01T12:10:00Z", "1.11", "1.12"),
      row("EURUSD", "2026-01-01T12:10:00Z", "2026-01-01T12:15:00Z", "1.12", "1.13"),
    ].join("\n");
    const provider = new CSVCandleProvider(csv);
    const candles = await provider.loadCandles();
    const gaps = detectMissingCandles(candles, 5);
    expect(gaps).toHaveLength(0);
  });
});

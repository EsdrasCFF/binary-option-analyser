import { describe, it, expect } from "vitest";
import { Candle, makeCandle } from "@/lib/core/candle-classifier";
import { findForwardValidDays } from "../forward-days";

function candleOn(dateISO: string, hhmm = "10:00"): Candle {
  const openTime = new Date(`${dateISO}T${hhmm}:00Z`);
  return makeCandle({
    symbol: "EUR/USD",
    timeframe: "5m",
    openTime,
    closeTime: new Date(openTime.getTime() + 5 * 60 * 1000),
    open: "1.1000",
    high: "1.1010",
    low: "1.0990",
    close: "1.1005",
    volume: "100",
    source: "test",
  });
}

describe("findForwardValidDays", () => {
  it("pula naturalmente dias sem candle (fins de semana), sem fabricar um dia artificial", () => {
    // referência: sexta 2026-01-02. Sábado/domingo (03/04) não têm candle.
    // Próximo candle real: segunda 2026-01-05.
    const candles = [candleOn("2026-01-05"), candleOn("2026-01-06")];
    const days = findForwardValidDays(candles, new Date("2026-01-02T00:00:00Z"), "UTC", 2);
    expect(days).toEqual(["2026-01-05", "2026-01-06"]);
  });

  it("não inclui o próprio dia de referência, só dias estritamente posteriores", () => {
    const candles = [candleOn("2026-01-02"), candleOn("2026-01-05")];
    const days = findForwardValidDays(candles, new Date("2026-01-02T00:00:00Z"), "UTC", 1);
    expect(days).toEqual(["2026-01-05"]);
  });

  it("pula buracos de dado no meio, mesmo em dias úteis", () => {
    // 06 e 07 são úteis mas sem candle carregado (gap de dado) — não devem aparecer.
    const candles = [candleOn("2026-01-05"), candleOn("2026-01-08")];
    const days = findForwardValidDays(candles, new Date("2026-01-02T00:00:00Z"), "UTC", 2);
    expect(days).toEqual(["2026-01-05", "2026-01-08"]);
  });

  it("devolve menos dias que o pedido quando não há candle suficiente à frente, sem inventar dia", () => {
    const candles = [candleOn("2026-01-05")];
    const days = findForwardValidDays(candles, new Date("2026-01-02T00:00:00Z"), "UTC", 5);
    expect(days).toEqual(["2026-01-05"]);
  });

  it("respeita o timezone informado ao decidir o dia local do candle", () => {
    // candle às 23:30 UTC de 05/01 é 00:30 do dia 06/01 em UTC+1
    const openTime = new Date("2026-01-05T23:30:00Z");
    const candle = makeCandle({
      symbol: "EUR/USD",
      timeframe: "5m",
      openTime,
      closeTime: new Date(openTime.getTime() + 5 * 60 * 1000),
      open: "1.1",
      high: "1.1",
      low: "1.1",
      close: "1.1",
      volume: null,
      source: "test",
    });
    const daysUtc = findForwardValidDays([candle], new Date("2026-01-02T00:00:00Z"), "UTC", 1);
    const daysPlus1 = findForwardValidDays([candle], new Date("2026-01-02T00:00:00Z"), "Etc/GMT-1", 1);
    expect(daysUtc).toEqual(["2026-01-05"]);
    expect(daysPlus1).toEqual(["2026-01-06"]);
  });
});

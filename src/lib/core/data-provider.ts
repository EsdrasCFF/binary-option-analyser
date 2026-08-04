/**
 * Abstração de fontes de dados de candles.
 *
 * Qualquer fonte futura (API de corretora, arquivo Parquet, banco externo etc.)
 * deve implementar CandleDataProvider. Nenhuma API de corretora é inventada
 * aqui — apenas a interface + um provider CSV real.
 */
import { Decimal } from "decimal.js";
import { Candle, makeCandle } from "./candle-classifier";

export const REQUIRED_CSV_COLUMNS = [
  "symbol",
  "timeframe",
  "open_time",
  "close_time",
  "open",
  "high",
  "low",
  "close",
  "volume",
];

export interface CandleDataProvider {
  loadCandles(): Promise<Candle[]>;
}

export interface CSVCandleProviderOptions {
  sourceName?: string;
  assumeUtcIfNaive?: boolean;
}

/**
 * Provider inicial: lê candles de um conteúdo CSV (string) já carregado.
 * Formato esperado (cabeçalho obrigatório):
 *   symbol,timeframe,open_time,close_time,open,high,low,close,volume
 *
 * Mantido agnóstico de I/O (recebe o conteúdo já lido) para funcionar tanto
 * em Route Handlers do Next (upload via FormData) quanto em scripts/testes.
 */
export class CSVCandleProvider implements CandleDataProvider {
  private csvContent: string;
  private sourceName: string;
  private assumeUtcIfNaive: boolean;

  constructor(csvContent: string, options: CSVCandleProviderOptions = {}) {
    this.csvContent = csvContent;
    this.sourceName = options.sourceName ?? "csv_import";
    this.assumeUtcIfNaive = options.assumeUtcIfNaive ?? true;
  }

  private parseDate(raw: string): Date {
    const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw.trim());
    const iso = hasTimezone ? raw : this.assumeUtcIfNaive ? `${raw}Z` : raw;
    if (!hasTimezone && !this.assumeUtcIfNaive) {
      throw new Error(`Data sem timezone e assumeUtcIfNaive=false: ${raw}`);
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Data inválida: ${raw}`);
    }
    return date;
  }

  async loadCandles(): Promise<Candle[]> {
    const lines = this.csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      throw new Error("CSV vazio.");
    }

    const header = parseCsvLine(lines[0]);
    const missing = REQUIRED_CSV_COLUMNS.filter((col) => !header.includes(col));
    if (missing.length > 0) {
      throw new Error(`Colunas obrigatórias ausentes no CSV: ${missing.join(", ")}`);
    }

    const colIndex = Object.fromEntries(header.map((name, idx) => [name, idx]));
    const candles: Candle[] = [];
    const seenKeys = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const rowNum = i + 1;
      try {
        const cols = parseCsvLine(lines[i]);
        const get = (name: string) => cols[colIndex[name]];

        const openTime = this.parseDate(get("open_time"));
        const closeTime = this.parseDate(get("close_time"));
        const symbol = normalizeSymbol(get("symbol"));
        const timeframe = get("timeframe").trim();

        const key = `${symbol}|${timeframe}|${openTime.toISOString()}`;
        if (seenKeys.has(key)) continue; // duplicado: ignora
        seenKeys.add(key);

        const volumeRaw = get("volume");
        candles.push(
          makeCandle({
            symbol,
            timeframe,
            openTime,
            closeTime,
            open: get("open"),
            high: get("high"),
            low: get("low"),
            close: get("close"),
            volume: volumeRaw ? new Decimal(volumeRaw) : null,
            source: this.sourceName,
          })
        );
      } catch (e) {
        throw new Error(`Erro na linha ${rowNum} do CSV: ${(e as Error).message}`);
      }
    }

    candles.sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
    return candles;
  }
}

function parseCsvLine(line: string): string[] {
  // parser simples o suficiente para o formato definido (sem aspas/escapes complexos)
  return line.split(",").map((c) => c.trim());
}

function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[-_/]/g, "");
  if (s.length === 6) {
    return `${s.slice(0, 3)}/${s.slice(3)}`;
  }
  return raw.trim().toUpperCase();
}

/**
 * Retorna lista de gaps (início, fim) onde candles esperados não foram
 * encontrados, considerando apenas a sequência temporal fornecida
 * (já deve estar filtrada por symbol+timeframe).
 */
export function detectMissingCandles(
  candles: Candle[],
  expectedIntervalMinutes: number
): Array<{ from: Date; to: Date }> {
  const gaps: Array<{ from: Date; to: Date }> = [];
  const sorted = [...candles].sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
  const expectedDeltaMs = expectedIntervalMinutes * 60 * 1000;

  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const curr = sorted[i + 1];
    const deltaMs = curr.openTime.getTime() - prev.openTime.getTime();
    if (deltaMs > expectedDeltaMs) {
      gaps.push({ from: prev.closeTime, to: curr.openTime });
    }
  }
  return gaps;
}

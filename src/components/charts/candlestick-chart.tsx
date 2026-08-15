"use client";

import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Candle } from "@/lib/api-client/types";
import { formatDateTime } from "@/lib/format";

const UP_COLOR = "#16a34a";
const DOWN_COLOR = "#dc2626";

interface CandlePoint {
  openTime: string;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  range: [number, number];
}

function toPoints(candles: Candle[]): CandlePoint[] {
  return candles.map((c) => {
    const open = Number(c.open);
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);
    return { openTime: c.openTime, label: formatDateTime(c.openTime), open, high, low, close, range: [low, high] };
  });
}

/**
 * `dataKey="range"` com valor `[low, high]` faz o recharts calcular `y`/`height`
 * do Bar já mapeados pra esse intervalo no eixo Y — daí dá pra achar a posição
 * de `open`/`close` por interpolação linear dentro do próprio y/height, sem
 * precisar acessar a escala do eixo diretamente (recharts não expõe isso pro
 * shape do Bar).
 */
function CandleShape(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: CandlePoint;
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload) return null;
  const { open, close, high, low } = payload;

  const color = close >= open ? UP_COLOR : DOWN_COLOR;
  const domainRange = high - low;
  const yFor = (value: number) => (domainRange === 0 ? y : y + ((high - value) / domainRange) * height);

  const bodyTop = yFor(Math.max(open, close));
  const bodyBottom = yFor(Math.min(open, close));
  const bodyHeight = Math.max(bodyBottom - bodyTop, 1);
  const centerX = x + width / 2;
  const bodyWidth = Math.max(width * 0.7, 1);
  const bodyX = centerX - bodyWidth / 2;

  return (
    <g>
      <line x1={centerX} y1={y} x2={centerX} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={bodyX} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} />
    </g>
  );
}

function CandleTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: CandlePoint }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{formatDateTime(p.openTime)}</p>
      <p>Abertura: {p.open.toFixed(5)}</p>
      <p>Máxima: {p.high.toFixed(5)}</p>
      <p>Mínima: {p.low.toFixed(5)}</p>
      <p>Fechamento: {p.close.toFixed(5)}</p>
    </div>
  );
}

export function CandlestickChart({ candles }: { candles: Candle[] }) {
  const data = toPoints(candles);
  const lows = data.map((d) => d.low);
  const highs = data.map((d) => d.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const padding = (max - min) * 0.05 || max * 0.001 || 1;

  return (
    <ResponsiveContainer width="100%" height={480}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="label" fontSize={11} tickLine={false} minTickGap={60} />
        <YAxis
          domain={[min - padding, max + padding]}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={72}
          tickFormatter={(v) => Number(v).toFixed(4)}
        />
        <Tooltip content={<CandleTooltip />} />
        <Bar dataKey="range" shape={CandleShape} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

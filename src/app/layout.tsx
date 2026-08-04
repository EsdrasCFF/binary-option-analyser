import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Análise Estatística e Backtest de Candles",
  description: "Sistema de análise estatística e backtest de padrões de horário em candles.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}

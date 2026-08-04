export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Análise Estatística e Backtest de Candles
      </h1>
      <p className="mt-2 text-slate-400">
        Estrutura inicial do App Router. As 16 telas do projeto (dashboard,
        análises, ranking de padrões, backtest, calculadora de entradas etc.)
        serão implementadas nas próximas fases, consumindo os Route Handlers
        em <code className="rounded bg-slate-900 px-1.5 py-0.5">src/app/api</code>{" "}
        e o motor de domínio em{" "}
        <code className="rounded bg-slate-900 px-1.5 py-0.5">src/lib/core</code>.
      </p>
    </main>
  );
}

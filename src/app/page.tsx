import { auth, signIn, signOut } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();

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

      <div className="mt-8 rounded-lg border border-slate-800 p-4">
        {session?.user ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-300">
              Conectado como <strong>{session.user.email}</strong>
            </p>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button
                type="submit"
                className="rounded bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
              >
                Sair
              </button>
            </form>
          </div>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <button
              type="submit"
              className="rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-900 hover:bg-white"
            >
              Entrar com Google
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

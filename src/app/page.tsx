import { auth, signIn, signOut } from "@/auth";
import { Button } from "@/components/ui/button";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Análise Estatística e Backtest de Candles
      </h1>
      <p className="mt-2 text-muted-foreground">
        Estrutura inicial do App Router. As 16 telas do projeto (dashboard,
        análises, ranking de padrões, backtest, calculadora de entradas etc.)
        serão implementadas nas próximas fases, consumindo os Route Handlers
        em <code className="rounded bg-muted px-1.5 py-0.5">src/app/api</code>{" "}
        e o motor de domínio em{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">src/lib/core</code>.
      </p>

      <div className="mt-8 rounded-lg border p-4">
        {session?.user ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Conectado como <strong className="text-foreground">{session.user.email}</strong>
            </p>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <Button type="submit" variant="outline">
                Sair
              </Button>
            </form>
          </div>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <Button type="submit">Entrar com Google</Button>
          </form>
        )}
      </div>
    </main>
  );
}

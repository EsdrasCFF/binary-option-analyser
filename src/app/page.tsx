import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Análise Estatística e Backtest de Candles
      </h1>
      <p className="mt-2 text-muted-foreground">
        Descoberta de padrões por horário e simulação de estratégias com
        Martingale para opções binárias.
      </p>

      <div className="mt-8 rounded-lg border p-4">
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/dashboard" });
          }}
        >
          <Button type="submit" className="w-full">
            Entrar com Google
          </Button>
        </form>
      </div>
    </main>
  );
}

import { auth, signOut } from "@/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function initialsFrom(name?: string | null, email?: string | null): string {
  const source = name ?? email ?? "?";
  return source.trim().slice(0, 2).toUpperCase();
}

export default async function SettingsPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">Dados da sua conta.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conta</CardTitle>
          <CardDescription>Autenticado via Google.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Avatar className="size-14">
            <AvatarFallback className="text-lg">{initialsFrom(user?.name, user?.email)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{user?.name ?? "Usuário"}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessão</CardTitle>
          <CardDescription>Encerrar o acesso neste dispositivo.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <Button type="submit" variant="outline">
              Sair da conta
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

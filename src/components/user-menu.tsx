import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { auth, signOut } from "@/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initialsFrom(name?: string | null, email?: string | null): string {
  const source = name ?? email ?? "?";
  return source.trim().slice(0, 2).toUpperCase();
}

export async function UserMenu() {
  const session = await auth();
  if (!session?.user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" />}>
        <Avatar className="size-8">
          <AvatarFallback>{initialsFrom(session.user.name, session.user.email)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="font-medium">{session.user.name ?? "Usuário"}</span>
          <span className="text-xs font-normal text-muted-foreground">{session.user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings" />}>
          <Settings />
          Configurações
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
              className="w-full"
            />
          }
        >
          <button type="submit" className="flex w-full items-center gap-2">
            <LogOut className="size-4" />
            Sair
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

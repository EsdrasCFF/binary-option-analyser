"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CandlestickChart,
  Calculator,
  ClipboardList,
  Database,
  FileUp,
  Gauge,
  History,
  LineChart,
  ListChecks,
  Sparkles,
  Wallet,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Visão geral",
    items: [{ href: "/dashboard", label: "Dashboard", icon: Gauge }],
  },
  {
    label: "Dados",
    items: [
      { href: "/import/csv", label: "Importar CSV", icon: FileUp },
      { href: "/import/yahoo", label: "Importar Yahoo Finance", icon: FileUp },
      { href: "/data-providers", label: "Pares e fontes de dados", icon: Database },
      { href: "/candles", label: "Visualização de velas", icon: CandlestickChart },
    ],
  },
  {
    label: "Análise",
    items: [
      { href: "/analyses/new", label: "Nova análise", icon: LineChart },
      { href: "/analyses", label: "Análises", icon: ListChecks },
      { href: "/analyses-plus/new", label: "Nova análise Plus", icon: Sparkles },
      { href: "/analyses-plus", label: "Análises Plus", icon: ListChecks },
    ],
  },
  {
    label: "Backtest",
    items: [
      { href: "/backtests/new", label: "Novo backtest", icon: BarChart3 },
      { href: "/backtests", label: "Backtests", icon: History },
      { href: "/bankroll-ledgers", label: "Gerenciamentos de banca", icon: ClipboardList },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { href: "/tools/martingale-calculator", label: "Calculadora de entradas", icon: Calculator },
      { href: "/bankroll-configurations", label: "Configurações de banca", icon: Wallet },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/dashboard" className="flex items-center gap-2 px-2 py-1.5">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            BO
          </span>
          <span className="text-sm font-semibold group-data-[collapsible=icon]:hidden">
            Analytics
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={pathname === item.href}
                      tooltip={item.label}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

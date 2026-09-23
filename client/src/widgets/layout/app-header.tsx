/**
 * En-tête applicatif : fil d'Ariane, recherche globale (⌘K), état de synchronisation,
 * thème et raccourci caisse.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCashRegister, IconSearch } from "@tabler/icons-react";
import { Link, useLocation } from "wouter";

import { useSession } from "@/shared/auth/session";
import { flattenNav, visibleNavGroups } from "@/shared/config/nav";
import { useIsMac } from "@/shared/hooks/use-platform";
import { CustomizerButton } from "@/shared/components/theme-customizer";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { Button } from "@/shared/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/breadcrumb";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";
import { Kbd, KbdGroup } from "@/shared/ui/kbd";
import { Separator } from "@/shared/ui/separator";
import { SidebarTrigger } from "@/shared/ui/sidebar";
import type { SyncStatus } from "@/shared/offline/sync-engine";
import { SyncIndicator } from "./sync-indicator";

/** Segments d'URL dont le libellé humain ne se déduit pas du texte. */
const CRUMB_LABELS: Record<string, string> = {
  pos: "Caisse",
  quotes: "Devis",
  "sales-orders": "Commandes",
  invoices: "Factures",
  "credit-notes": "Avoirs",
  payments: "Règlements",
  "purchase-orders": "Commandes fournisseurs",
  "goods-receipts": "Réceptions",
  "supplier-invoices": "Factures fournisseurs",
  inventory: "Stock",
  movements: "Mouvements",
  warehouses: "Magasins",
  parties: "Tiers",
  products: "Produits",
  categories: "Catégories",
  services: "Prestations",
  banking: "Trésorerie",
  accounting: "Comptabilité",
  entries: "Journal",
  ledger: "Grand livre",
  balance: "Balance",
  accounts: "Plan comptable",
  settings: "Paramètres",
  company: "Société",
  users: "Utilisateurs",
  roles: "Rôles",
  modules: "Modules",
  numbering: "Numérotation",
  registers: "Caisses",
  audit: "Audit",
  reports: "Rapports",
  sales: "Ventes",
  stock: "Stock",
  purchases: "Achats",
  sync: "Synchronisation",
  "auto-parts": "Pièces auto",
  clothing: "Vêtements",
  market: "Marché",
  search: "Recherche",
  equivalences: "Équivalences",
  manufacturers: "Fabricants",
  vehicles: "Véhicules",
  "size-grids": "Grilles de tailles",
  lots: "Lots",
  expiring: "Péremption",
  new: "Nouveau",
  profile: "Profil",
};

function useBreadcrumb(pathname: string): string[] {
  return useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return ["Tableau de bord"];
    return segments.map((segment) => {
      if (CRUMB_LABELS[segment]) return CRUMB_LABELS[segment];
      // Les identifiants (UUID) n'ont pas de libellé lisible : on les abrège.
      if (/^[0-9a-f]{8}-/i.test(segment)) return `#${segment.slice(0, 8)}`;
      return segment.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    });
  }, [pathname]);
}

export function AppHeader({ syncStatus }: { syncStatus: SyncStatus }) {
  const [pathname, navigate] = useLocation();
  const crumbs = useBreadcrumb(pathname);
  const isMac = useIsMac();
  const [open, setOpen] = useState(false);
  const { can, hasModule } = useSession();

  const entries = useMemo(() => flattenNav(visibleNavGroups(can, hasModule)), [can, hasModule]);

  const go = useCallback(
    (url: string) => {
      setOpen(false);
      navigate(url);
    },
    [navigate]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const grouped = useMemo(() => {
    const byGroup = new Map<string, { title: string; url: string }[]>();
    for (const entry of entries) {
      const bucket = byGroup.get(entry.group) ?? [];
      bucket.push({ title: entry.title, url: entry.url });
      byGroup.set(entry.group, bucket);
    }
    return [...byGroup.entries()];
  }, [entries]);

  return (
    <header
      data-app-header
      className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <SidebarTrigger className="-ms-1" />
      <Separator orientation="vertical" className="me-1 h-4" />

      <Breadcrumb className="min-w-0">
        <BreadcrumbList>
          {crumbs.map((crumb, index) => (
            <BreadcrumbItem key={`${crumb}-${index}`} className="min-w-0">
              {index > 0 ? <BreadcrumbSeparator className="me-1.5" /> : null}
              <BreadcrumbPage className="truncate">{crumb}</BreadcrumbPage>
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ms-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="hidden gap-2 text-muted-foreground md:flex"
          onClick={() => setOpen(true)}
        >
          <IconSearch className="size-4" />
          <span>Rechercher…</span>
          <KbdGroup className="ms-2">
            <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Rechercher"
          onClick={() => setOpen(true)}
        >
          <IconSearch className="size-4" />
        </Button>

        {can("pos.use") ? (
          <Button variant="ghost" size="sm" asChild className="gap-2">
            <Link href="/pos">
              <IconCashRegister className="size-4" />
              <span className="hidden lg:inline">Caisse</span>
            </Link>
          </Button>
        ) : null}

        <SyncIndicator status={syncStatus} />
        <ThemeToggle />
        <CustomizerButton />
      </div>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Rechercher un écran…" />
        <CommandList>
          <CommandEmpty>Aucun résultat.</CommandEmpty>
          {grouped.map(([group, items]) => (
            <CommandGroup key={group} heading={group}>
              {items.map((item) => (
                <CommandItem
                  key={item.url}
                  value={`${group} ${item.title}`}
                  onSelect={() => go(item.url)}
                >
                  {item.title}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </header>
  );
}

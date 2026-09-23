/**
 * Routage de l'application (wouter).
 *
 * Trois zones distinctes :
 *  - **publique** : connexion ;
 *  - **plein écran** : point de vente, qui occupe tout l'écran d'une caisse ;
 *  - **applicative** : tous les autres écrans, dans la coquille avec barre latérale.
 *
 * Les pages sont chargées à la demande : le bundle initial reste léger, ce qui compte
 * sur une connexion lente — et la coquille reste disponible hors ligne une fois mise
 * en cache par le Service Worker.
 */

import { Suspense, lazy, type ComponentType } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";

import { useSession } from "@/shared/auth/session";
import { AppLayout, FullscreenLayout } from "@/widgets/layout/app-layout";
import { Skeleton } from "@/shared/ui/skeleton";

const LoginPage = lazy(() => import("@/pages/login"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const PosPage = lazy(() => import("@/pages/pos"));
const PartiesPage = lazy(() => import("@/pages/parties/list"));
const PartyDetailPage = lazy(() => import("@/pages/parties/detail"));
const ProductsPage = lazy(() => import("@/pages/catalog/products"));
const ProductFormPage = lazy(() => import("@/pages/catalog/product-form"));
const CategoriesPage = lazy(() => import("@/pages/catalog/categories"));
const ServicesPage = lazy(() => import("@/pages/catalog/services"));
const InventoryPage = lazy(() => import("@/pages/inventory/stock"));
const MovementsPage = lazy(() => import("@/pages/inventory/movements"));
const WarehousesPage = lazy(() => import("@/pages/inventory/warehouses"));
const QuotesPage = lazy(() => import("@/pages/sales/quotes"));
const QuoteFormPage = lazy(() => import("@/pages/sales/quote-form"));
const QuoteDetailPage = lazy(() => import("@/pages/sales/quote-detail"));
const SalesOrdersPage = lazy(() => import("@/pages/sales/orders"));
const SalesOrderDetailPage = lazy(() => import("@/pages/sales/order-detail"));
const InvoicesPage = lazy(() => import("@/pages/invoicing/invoices"));
const InvoiceFormPage = lazy(() => import("@/pages/invoicing/invoice-form"));
const InvoiceDetailPage = lazy(() => import("@/pages/invoicing/invoice-detail"));
const CreditNotesPage = lazy(() => import("@/pages/invoicing/credit-notes"));
const PaymentsPage = lazy(() => import("@/pages/payments"));
const PurchaseOrdersPage = lazy(() => import("@/pages/purchasing/orders"));
const PurchaseOrderFormPage = lazy(() => import("@/pages/purchasing/order-form"));
const PurchaseOrderDetailPage = lazy(() => import("@/pages/purchasing/order-detail"));
const GoodsReceiptsPage = lazy(() => import("@/pages/purchasing/receipts"));
const SupplierInvoicesPage = lazy(() => import("@/pages/purchasing/supplier-invoices"));
const BankingPage = lazy(() => import("@/pages/banking"));
const EntriesPage = lazy(() => import("@/pages/accounting/entries"));
const LedgerPage = lazy(() => import("@/pages/accounting/ledger"));
const BalancePage = lazy(() => import("@/pages/accounting/balance"));
const ChartOfAccountsPage = lazy(() => import("@/pages/accounting/accounts"));
const SalesReportPage = lazy(() => import("@/pages/reports/sales"));
const StockReportPage = lazy(() => import("@/pages/reports/stock"));
const PurchasesReportPage = lazy(() => import("@/pages/reports/purchases"));
const OemSearchPage = lazy(() => import("@/pages/modules/auto-parts/search"));
const EquivalencesPage = lazy(() => import("@/pages/modules/auto-parts/equivalences"));
const ManufacturersPage = lazy(() => import("@/pages/modules/auto-parts/manufacturers"));
const VehiclesPage = lazy(() => import("@/pages/modules/auto-parts/vehicles"));
const SizeGridsPage = lazy(() => import("@/pages/modules/clothing/size-grids"));
const LotsPage = lazy(() => import("@/pages/modules/market/lots"));
const ExpiringPage = lazy(() => import("@/pages/modules/market/expiring"));
const CompanySettingsPage = lazy(() => import("@/pages/settings/company"));
const ModulesSettingsPage = lazy(() => import("@/pages/settings/modules"));
const NumberingSettingsPage = lazy(() => import("@/pages/settings/numbering"));
const RegistersSettingsPage = lazy(() => import("@/pages/settings/registers"));
const UsersSettingsPage = lazy(() => import("@/pages/settings/users"));
const RolesSettingsPage = lazy(() => import("@/pages/settings/roles"));
const SyncPage = lazy(() => import("@/pages/sync"));
const ProfilePage = lazy(() => import("@/pages/profile"));
const NotFoundPage = lazy(() => import("@/pages/not-found"));

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** Écran d'attente du démarrage, avant de savoir si une session existe. */
function BootScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="size-10 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">Chargement de l'ERP…</p>
      </div>
    </div>
  );
}

/** Routes de l'application, montées dans la coquille standard. */
function AppRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Switch>
        <Route path="/" component={DashboardPage} />

        <Route path="/parties" component={PartiesPage} />
        <Route path="/parties/:id" component={PartyDetailPage} />

        <Route path="/products" component={ProductsPage} />
        <Route path="/products/new" component={ProductFormPage} />
        <Route path="/products/:id/edit" component={ProductFormPage} />
        <Route path="/categories" component={CategoriesPage} />
        <Route path="/services" component={ServicesPage} />

        <Route path="/inventory" component={InventoryPage} />
        <Route path="/inventory/movements" component={MovementsPage} />
        <Route path="/warehouses" component={WarehousesPage} />

        <Route path="/quotes" component={QuotesPage} />
        <Route path="/quotes/new" component={QuoteFormPage} />
        <Route path="/quotes/:id" component={QuoteDetailPage} />
        <Route path="/sales-orders" component={SalesOrdersPage} />
        <Route path="/sales-orders/:id" component={SalesOrderDetailPage} />

        <Route path="/invoices" component={InvoicesPage} />
        <Route path="/invoices/new" component={InvoiceFormPage} />
        <Route path="/invoices/:id" component={InvoiceDetailPage} />
        <Route path="/credit-notes" component={CreditNotesPage} />
        <Route path="/payments" component={PaymentsPage} />

        <Route path="/purchase-orders" component={PurchaseOrdersPage} />
        <Route path="/purchase-orders/new" component={PurchaseOrderFormPage} />
        <Route path="/purchase-orders/:id" component={PurchaseOrderDetailPage} />
        <Route path="/goods-receipts" component={GoodsReceiptsPage} />
        <Route path="/supplier-invoices" component={SupplierInvoicesPage} />

        <Route path="/banking" component={BankingPage} />

        <Route path="/accounting/entries" component={EntriesPage} />
        <Route path="/accounting/ledger" component={LedgerPage} />
        <Route path="/accounting/balance" component={BalancePage} />
        <Route path="/accounting/accounts" component={ChartOfAccountsPage} />

        <Route path="/reports/sales" component={SalesReportPage} />
        <Route path="/reports/stock" component={StockReportPage} />
        <Route path="/reports/purchases" component={PurchasesReportPage} />

        <Route path="/modules/auto-parts/search" component={OemSearchPage} />
        <Route path="/modules/auto-parts/equivalences" component={EquivalencesPage} />
        <Route path="/modules/auto-parts/manufacturers" component={ManufacturersPage} />
        <Route path="/modules/auto-parts/vehicles" component={VehiclesPage} />
        <Route path="/modules/clothing/size-grids" component={SizeGridsPage} />
        <Route path="/modules/market/lots" component={LotsPage} />
        <Route path="/modules/market/expiring" component={ExpiringPage} />

        <Route path="/settings/company" component={CompanySettingsPage} />
        <Route path="/settings/modules" component={ModulesSettingsPage} />
        <Route path="/settings/numbering" component={NumberingSettingsPage} />
        <Route path="/settings/registers" component={RegistersSettingsPage} />
        <Route path="/settings/users" component={UsersSettingsPage} />
        <Route path="/settings/roles" component={RolesSettingsPage} />

        <Route path="/sync" component={SyncPage} />
        <Route path="/profile" component={ProfilePage} />

        <Route component={NotFoundPage} />
      </Switch>
    </Suspense>
  );
}

export function AppRouter() {
  const { status } = useSession();
  const [location] = useLocation();

  if (status === "loading") return <BootScreen />;

  if (status === "anonymous") {
    return (
      <Suspense fallback={<BootScreen />}>
        <Switch>
          <Route path="/login" component={LoginPage as ComponentType} />
          <Route>
            {/* Toute autre adresse renvoie vers la connexion, en gardant la
                destination pour y revenir une fois authentifié. */}
            <Redirect
              to={`/login${location !== "/" ? `?next=${encodeURIComponent(location)}` : ""}`}
            />
          </Route>
        </Switch>
      </Suspense>
    );
  }

  // Le point de vente sort de la coquille standard : plein écran, sans barre latérale.
  if (location.startsWith("/pos")) {
    return (
      <FullscreenLayout>
        <Suspense fallback={<PageFallback />}>
          <Route path="/pos" component={PosPage} />
        </Suspense>
      </FullscreenLayout>
    );
  }

  if (location === "/login") return <Redirect to="/" />;

  return (
    <AppLayout>
      <AppRoutes />
    </AppLayout>
  );
}

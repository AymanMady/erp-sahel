/**
 * Application routing (wouter).
 *
 * Three distinct areas:
 *  - **public**: sign-in;
 *  - **full screen**: point of sale, which takes the whole screen of a till;
 *  - **application**: every other screen, inside the shell with the sidebar.
 *
 * Pages are loaded on demand: the initial bundle stays light, which matters on a slow
 * connection — and the shell stays available offline once cached by the Service
 * Worker.
 */

import { Suspense, lazy, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Redirect, Route, Switch, useLocation } from "wouter";

import { useSession } from "@/shared/auth/session";
import { AppLayout, FullscreenLayout } from "@/widgets/layout/app-layout";
import { ModuleGate } from "@/widgets/layout/module-gate";
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

/** Startup waiting screen, shown before knowing whether a session exists. */
function BootScreen() {
  const { t } = useTranslation("layout");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="size-10 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">{t("boot.loading")}</p>
      </div>
    </div>
  );
}

/** Application routes, mounted inside the standard shell. */
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
            {/* Any other path redirects to sign-in, keeping the destination to
                come back to once authenticated. */}
            <Redirect
              to={`/login${location !== "/" ? `?next=${encodeURIComponent(location)}` : ""}`}
            />
          </Route>
        </Switch>
      </Suspense>
    );
  }

  // The point of sale leaves the standard shell: full screen, without sidebar.
  if (location.startsWith("/pos")) {
    return (
      <FullscreenLayout>
        <ModuleGate>
          <Suspense fallback={<PageFallback />}>
            <Route path="/pos" component={PosPage} />
          </Suspense>
        </ModuleGate>
      </FullscreenLayout>
    );
  }

  if (location === "/login") return <Redirect to="/" />;

  return (
    <AppLayout>
      <ModuleGate>
        <AppRoutes />
      </ModuleGate>
    </AppLayout>
  );
}

/**
 * Dashboard — the first screen after signing in.
 *
 * Design choice: the indicators answer the questions a manager asks when opening the
 * ERP in the morning — how much did I sell, how much am I owed, what is left in the
 * till, which stock-outs are coming ([FR-RPT-3]).
 */

import { useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconBuildingBank,
  IconCashRegister,
  IconFileInvoice,
  IconPackages,
  IconPlus,
  IconReceipt2,
  IconTrendingUp,
  IconTruckDelivery,
  IconUserPlus,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { addDays, formatDate, todayInput } from "@shared/format";
import { centsToMajor } from "@shared/money";
import { reportsApi } from "@/entities/reports/api";
import { queryKeys } from "@/shared/api/query-client";
import { currentIntlLocale } from "@/shared/i18n";
import { useDirection } from "@/shared/i18n/direction-provider";
import type { PermissionCode } from "@shared/rbac";
import type { ModuleCode } from "@shared/schema";
import { useSession } from "@/shared/auth/session";
import { PageHeader } from "@/shared/components/page-header";
import { Money, useMoneyFormatter } from "@/shared/components/money";
import { StatCard } from "@/shared/components/stat-card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";

/**
 * Everyday actions as large buttons: a shopkeeper finds what they do every day
 * without browsing the menu. Only those of active modules are shown.
 */
const QUICK_ACTIONS: {
  labelKey: string;
  href: string;
  icon: Icon;
  module?: ModuleCode;
  permission: PermissionCode;
}[] = [
  {
    labelKey: "quickActions.sell",
    href: "/pos",
    icon: IconCashRegister,
    module: "pos",
    permission: "pos.use",
  },
  {
    labelKey: "quickActions.newInvoice",
    href: "/invoices/new",
    icon: IconFileInvoice,
    module: "invoicing",
    permission: "invoicing.write",
  },
  {
    labelKey: "quickActions.buy",
    href: "/purchase-orders/new",
    icon: IconTruckDelivery,
    module: "purchasing",
    permission: "purchasing.write",
  },
  {
    labelKey: "quickActions.newProduct",
    href: "/products/new",
    icon: IconPlus,
    permission: "catalog.write",
  },
  {
    labelKey: "quickActions.viewStock",
    href: "/inventory",
    icon: IconPackages,
    module: "inventory",
    permission: "inventory.read",
  },
  {
    labelKey: "quickActions.newCustomer",
    href: "/parties",
    icon: IconUserPlus,
    permission: "parties.write",
  },
];

/** Selectable periods, in days. */
const PERIODS = ["7", "30", "90"];

export default function DashboardPage() {
  const { t, i18n } = useTranslation("dashboard");
  const rtl = useDirection() === "rtl";
  const { user, can, hasModule } = useSession();
  const quickActions = QUICK_ACTIONS.filter(
    (action) => (!action.module || hasModule(action.module)) && can(action.permission)
  );
  const [days, setDays] = useState("30");
  const formatMoneyValue = useMoneyFormatter();

  const period = useMemo(() => {
    const toDate = todayInput();
    return { fromDate: addDays(toDate, -(Number(days) - 1)), toDate };
  }, [days]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard(period),
    queryFn: () => reportsApi.dashboard(period),
  });

  const chartData = useMemo(
    () =>
      (data?.dailyRevenue ?? []).map((row) => ({
        date: row.date,
        label: formatDate(row.date),
        revenue: centsToMajor(row.totalHtCents),
      })),
    // The language is a dependency: date labels follow the UI locale.
    [data, i18n.language]
  );

  const greeting = user?.firstName
    ? t("greetingWithName", { name: user.firstName })
    : t("greeting");

  return (
    <div className="space-y-6">
      <PageHeader title={greeting} description={t("description")}>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[180px]" aria-label={t("periodLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((value) => (
              <SelectItem key={value} value={value}>
                {t("lastDays", { count: Number(value) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {can("pos.use") && hasModule("pos") ? (
          <Button asChild>
            <Link href="/pos">
              <IconCashRegister className="size-4" />
              {t("openRegister")}
            </Link>
          </Button>
        ) : null}
      </PageHeader>

      {quickActions.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center text-sm font-medium shadow-xs transition-colors hover:border-primary hover:bg-primary/5"
            >
              <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <action.icon className="size-6" />
              </span>
              {t(action.labelKey)}
            </Link>
          ))}
        </div>
      ) : null}

      {error && !data ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">{t("offline")}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("stats.revenue")}
          value={formatMoneyValue(data?.sales.totalHtCents ?? 0)}
          hint={t("stats.invoicesHint", { count: data?.sales.invoiceCount ?? 0 })}
          icon={<IconTrendingUp className="size-4" />}
          loading={isLoading}
        />
        <StatCard
          label={t("stats.outstanding")}
          value={formatMoneyValue(data?.sales.outstandingCents ?? 0)}
          hint={t("stats.outstandingHint")}
          icon={<IconReceipt2 className="size-4" />}
          loading={isLoading}
          invertTrend
        />
        <StatCard
          label={t("stats.treasury")}
          value={formatMoneyValue(data?.treasury.totalCents ?? 0)}
          hint={t("stats.treasuryHint", {
            cash: formatMoneyValue(data?.treasury.cashCents ?? 0),
            bank: formatMoneyValue(data?.treasury.bankCents ?? 0),
          })}
          icon={<IconBuildingBank className="size-4" />}
          loading={isLoading}
        />
        <StatCard
          label={t("stats.stockValue")}
          value={formatMoneyValue(data?.stock.totalValueCents ?? 0)}
          hint={t("stats.skusHint", { count: data?.stock.skuCount ?? 0 })}
          icon={<IconPackages className="size-4" />}
          loading={isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("revenueChart.title")}</CardTitle>
            <CardDescription>
              {t("revenueChart.description", {
                from: formatDate(period.fromDate),
                to: formatDate(period.toDate),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : chartData.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {t("revenueChart.empty")}
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenue-gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      reversed={rtl}
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      stroke="var(--muted-foreground)"
                      minTickGap={24}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      width={70}
                      orientation={rtl ? "right" : "left"}
                      stroke="var(--muted-foreground)"
                      tickFormatter={(value: number) =>
                        new Intl.NumberFormat(currentIntlLocale(), { notation: "compact" }).format(
                          value
                        )
                      }
                    />
                    <RechartsTooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        fontSize: 12,
                      }}
                      formatter={(value) => [
                        formatMoneyValue(Math.round(Number(value ?? 0) * 100)),
                        t("revenueChart.series"),
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      fill="url(#revenue-gradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("topSales.title")}</CardTitle>
            <CardDescription>{t("topSales.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))
            ) : (data?.topProducts.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("topSales.empty")}
              </p>
            ) : (
              data?.topProducts.map((product) => (
                <div
                  key={`${product.productId}-${product.productSku}`}
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{product.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {product.productSku || "—"} ·{" "}
                      {t("topSales.sold", { count: Number(product.quantity) })}
                    </p>
                  </div>
                  <Money cents={product.revenueCents} className="text-sm font-medium" />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <IconAlertTriangle className="size-4 text-status-pending" />
                {t("restock.title")}
              </CardTitle>
              <CardDescription>{t("restock.description")}</CardDescription>
            </div>
            {hasModule("inventory") ? (
              <Button variant="outline" size="sm" asChild>
                <Link href="/inventory">{t("restock.viewStock")}</Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))
            ) : (data?.lowStock.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("restock.empty")}</p>
            ) : (
              data?.lowStock.map((row) => (
                <div
                  key={row.productId}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.sku}</p>
                  </div>
                  <Badge variant="outline" className="tabular shrink-0">
                    {Number(row.quantity)} / {Number(row.minStock)}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("counts.title")}</CardTitle>
            <CardDescription>{t("counts.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CountRow
              icon={<IconUsers className="size-4" />}
              label={t("counts.customers")}
              value={data?.counts.customers}
              href="/parties"
              loading={isLoading}
            />
            <CountRow
              icon={<IconUsers className="size-4" />}
              label={t("counts.suppliers")}
              value={data?.counts.suppliers}
              href="/parties"
              loading={isLoading}
            />
            <CountRow
              icon={<IconPackages className="size-4" />}
              label={t("counts.products")}
              value={data?.counts.products}
              href="/products"
              loading={isLoading}
            />
            {hasModule("services") ? (
              <CountRow
                icon={<IconReceipt2 className="size-4" />}
                label={t("counts.services")}
                value={data?.counts.services}
                href="/services"
                loading={isLoading}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CountRow({
  icon,
  label,
  value,
  href,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  href: string;
  loading?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-muted"
    >
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </span>
      {loading ? (
        <Skeleton className="h-5 w-10" />
      ) : (
        <span className="tabular text-sm font-semibold">{value ?? 0}</span>
      )}
    </Link>
  );
}

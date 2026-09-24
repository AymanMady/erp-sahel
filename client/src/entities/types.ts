/**
 * Types de réponse de l'API, dérivés du schéma partagé.
 *
 * Réutiliser `@shared/schema` plutôt que redéclarer des interfaces côté client garantit
 * qu'un changement de colonne casse la compilation du client — et non silencieusement
 * son affichage.
 */

import type {
  AccountType,
  Contact,
  JournalEntry,
  JournalLine,
  ModuleCode,
  Party,
  PartyAddress,
  Payment,
  Product,
  ProductSupplier,
  ProductVariant,
  PublicUser,
  PurchaseOrder,
  PurchaseOrderLine,
  Quote,
  QuoteLine,
  Role,
  SalesInvoice,
  SalesInvoiceLine,
  SalesOrder,
  SalesOrderLine,
  StockItem,
  StockMovement,
} from "@shared/schema";

export type {
  Account,
  AccountMappingKey,
  BankAccount,
  BankTransaction,
  Category,
  Company,
  CreditNote,
  CreditNoteLine,
  FiscalYear,
  GoodsReceipt,
  GoodsReceiptLine,
  InventoryCount,
  Journal,
  JournalEntry,
  JournalLine,
  Party,
  PartyAddress,
  Contact,
  Payment,
  PosRegister,
  PosSession,
  Product,
  ProductVariant,
  PublicUser,
  PurchaseOrder,
  PurchaseOrderLine,
  Quote,
  QuoteLine,
  Role,
  SalesInvoice,
  SalesInvoiceLine,
  SalesOrder,
  SalesOrderLine,
  Service,
  StockItem,
  StockMovement,
  SupplierInvoice,
  SyncOperation,
  Warehouse,
} from "@shared/schema";

/** Enveloppe de liste paginée renvoyée par toutes les listes de l'API. */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProductListItem extends Product {
  categoryName: string | null;
  stockQuantity?: number;
}

export interface ProductDetail extends Product {
  variants: ProductVariant[];
  suppliers: {
    link: ProductSupplier;
    supplierName: string;
    supplierCode: string;
  }[];
  profile: AutoPartProfileView | ClothingProfileView | MarketProfileView | null;
  stockQuantity: number;
}

export interface AutoPartProfileView {
  productId: string;
  oemReference: string;
  oemNormalized: string;
  manufacturerId: string | null;
  countryId: string | null;
  qualityLevelId: string | null;
  manufacturerRef: string;
  warrantyMonths: number;
  manufacturerName?: string | null;
  countryName?: string | null;
  countryCode?: string | null;
  qualityLabel?: string | null;
}

export interface ClothingProfileView {
  productId: string;
  brand: string;
  gender: string;
  season: string;
  material: string;
  collection: string;
  sizeGridId: string | null;
  colors: string[];
  sizeGridName?: string | null;
}

export interface MarketProfileView {
  productId: string;
  brand: string;
  measureUnit: string;
  weightGrams: number;
  volumeMl: number;
  taxCategory: string;
  isPerishable: boolean;
  expiryAlertDays: number;
}

export interface PartyDetail extends Party {
  contacts: Contact[];
  addresses: PartyAddress[];
  history: {
    invoices: {
      id: string;
      number: string;
      date: string;
      status: string;
      totalTtcCents: number;
      paidAmountCents: number;
    }[];
    payments: {
      id: string;
      number: string;
      paymentDate: string;
      amountCents: number;
      paymentMethod: string;
      direction: string;
      invoiceId: string | null;
    }[];
  };
  outstandingCents: number;
}

export interface InvoiceListItem extends SalesInvoice {
  partyName: string;
  partyCode: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  lines: SalesInvoiceLine[];
}

export interface QuoteDetail extends Quote {
  lines: QuoteLine[];
  partyName: string;
}

export interface SalesOrderDetail extends SalesOrder {
  lines: SalesOrderLine[];
  partyName: string;
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  lines: PurchaseOrderLine[];
  supplierName: string;
}

export interface StockRow extends StockItem {
  productSku: string;
  productName: string;
  productUnit: string;
  warehouseName: string;
  minStock: string;
}

export interface MovementRow extends StockMovement {
  productSku: string;
  productName: string;
  warehouseName: string;
}

export interface PaymentRow extends Payment {
  partyName: string;
  invoiceNumber: string | null;
  bankAccountName: string | null;
}

export interface LedgerRow {
  lineId: string;
  entryId: string;
  entryNumber: string;
  date: string;
  journalCode: string;
  accountCode: string;
  accountName: string;
  label: string;
  reference: string;
  partyName: string | null;
  debitCents: number;
  creditCents: number;
}

export interface BalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: AccountType;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}

export interface EntryWithLines extends JournalEntry {
  journalCode: string;
  journalName: string;
  lines: (JournalLine & {
    accountCode: string;
    accountName: string;
  })[];
}

export interface DashboardData {
  period: { fromDate: string; toDate: string };
  sales: {
    invoiceCount: number;
    totalHtCents: number;
    totalTtcCents: number;
    paidCents: number;
    outstandingCents: number;
  };
  purchases: { orderCount: number; totalHtCents: number; totalTtcCents: number };
  treasury: { cashCents: number; bankCents: number; mobileCents: number; totalCents: number };
  stock: { totalQuantity: number; totalValueCents: number; skuCount: number };
  counts: { customers: number; suppliers: number; products: number; services: number };
  dailyRevenue: {
    date: string;
    totalHtCents: number;
    totalTtcCents: number;
    invoiceCount: number;
  }[];
  topProducts: {
    productId: string | null;
    productSku: string;
    description: string;
    quantity: string;
    revenueCents: number;
  }[];
  lowStock: { productId: string; sku: string; name: string; minStock: string; quantity: string }[];
  grossMarginCents: number;
}

export interface ModuleDescriptor {
  code: ModuleCode;
  /** `feature` : caisse, achats, stock… ; `business` : pièces auto, vêtements, marché. */
  kind: "feature" | "business";
  defaultEnabled: boolean;
  name: string;
  description: string;
  version: string;
  coreVersion: string;
  dependencies: string[];
  profileType?: string;
  icon: string;
  permissions: string[];
  navigation: unknown[];
  searchCriteria: { key: string; label: string; type: string; optionsEndpoint?: string }[];
  isEnabled: boolean;
  enabledVersion: string | null;
}

export interface UserWithRoles extends PublicUser {
  roles: Role[];
}

export interface RoleWithPermissions extends Role {
  permissions: string[];
}

/** Columns shared by the detail windows of documents (invoice, return, supplier invoice). */

import type { TFunction } from "i18next";

import { formatQuantity } from "@shared/money";
import type { Column } from "@/shared/components/resource-table";
import { Money } from "@/shared/components/money";

export interface DocumentLineLike {
  id: string;
  description: string;
  productSku: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  totalCents: number;
}

export function documentLineColumns<T extends DocumentLineLike>(t: TFunction): Column<T>[] {
  return [
    {
      id: "product",
      header: t("common:labels.product"),
      cell: (line) => (
        <div className="min-w-0 whitespace-normal">
          <p className="font-medium">{line.description}</p>
          {line.productSku ? (
            <p className="tabular text-xs text-muted-foreground">{line.productSku}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "quantity",
      header: t("common:labels.quantity"),
      align: "end",
      cell: (line) => (
        <span className="tabular">
          {formatQuantity(line.quantity)} {line.unit}
        </span>
      ),
    },
    {
      id: "unitPrice",
      header: t("common:labels.unitPrice"),
      align: "end",
      cell: (line) => <Money cents={line.unitPriceCents} />,
    },
    {
      id: "total",
      header: t("common:labels.total"),
      align: "end",
      cell: (line) => <Money cents={line.totalCents} className="font-medium" />,
    },
  ];
}

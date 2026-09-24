/** Merges the per-domain message catalogs. */

import { accountingMessages } from "./accounting";
import { authMessages } from "./auth";
import { bankingMessages } from "./banking";
import { catalogMessages } from "./catalog";
import { commonMessages } from "./common";
import { inventoryMessages } from "./inventory";
import { invoicingMessages } from "./invoicing";
import { numberingMessages } from "./numbering";
import { partiesMessages } from "./parties";
import { paymentsMessages } from "./payments";
import { pluginsMessages } from "./plugins";
import { posMessages } from "./pos";
import { purchasingMessages } from "./purchasing";
import { reportsMessages } from "./reports";
import { salesMessages } from "./sales";
import { servicesMessages } from "./services";
import { syncMessages } from "./sync";
import { tenancyMessages } from "./tenancy";
import { usersMessages } from "./users";
import type { MessageCatalog } from "./types";

const ALL: MessageCatalog[] = [
  accountingMessages,
  authMessages,
  bankingMessages,
  catalogMessages,
  commonMessages,
  inventoryMessages,
  invoicingMessages,
  numberingMessages,
  partiesMessages,
  paymentsMessages,
  pluginsMessages,
  posMessages,
  purchasingMessages,
  reportsMessages,
  salesMessages,
  servicesMessages,
  syncMessages,
  tenancyMessages,
  usersMessages,
];

export const catalogs: MessageCatalog = {
  fr: Object.assign({}, ...ALL.map((catalog) => catalog.fr)),
  ar: Object.assign({}, ...ALL.map((catalog) => catalog.ar)),
};

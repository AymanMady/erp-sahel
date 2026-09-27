/**
 * "Where does the money arrive?" — a single choice instead of a payment method plus an
 * account: the cashier taps Cash, Bankily, Masrvi, Sedad or the bank, and the payment
 * method follows from the kind of account.
 */

import { IconBuildingBank, IconCash, IconDeviceMobile } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import type { BankAccountType, PaymentMethod } from "@shared/schema";
import type { PaymentAccount } from "@/entities/banking/api";
import { cn } from "@/shared/lib/utils";

export interface PaymentChoice {
  key: string;
  label: string;
  accountType: BankAccountType;
  method: PaymentMethod;
  /** `null`: the server picks the account (the register's cash, or the default one). */
  bankAccountId: string | null;
}

const METHOD_BY_TYPE: Record<BankAccountType, PaymentMethod> = {
  CASH: "CASH",
  MOBILE_MONEY: "MOBILE_MONEY",
  BANK: "BANK_TRANSFER",
};

const TYPE_ORDER: BankAccountType[] = ["CASH", "MOBILE_MONEY", "BANK"];

const ICONS: Record<BankAccountType, typeof IconCash> = {
  CASH: IconCash,
  MOBILE_MONEY: IconDeviceMobile,
  BANK: IconBuildingBank,
};

/**
 * One choice per account, so a banking app added later shows up by itself. With
 * `registerCash`, the cash accounts are replaced by a single "Cash" choice: the money goes
 * into the drawer of the register being used. Cash is always offered, even before the
 * list is loaded, so a sale is never blocked; `types` limits the other choices.
 */
export function usePaymentChoices(
  accounts: PaymentAccount[] | undefined,
  options: { registerCash?: boolean; types?: BankAccountType[] } = {}
): PaymentChoice[] {
  const { t } = useTranslation("banking");
  const types = options.types ?? TYPE_ORDER;

  const choices: PaymentChoice[] = [];
  for (const type of TYPE_ORDER) {
    if (type !== "CASH" && !types.includes(type)) continue;
    const ofType = (accounts ?? []).filter((account) => account.accountType === type);
    if (type === "CASH" && (ofType.length === 0 || options.registerCash)) {
      choices.push({
        key: type,
        label: t("picker.cash"),
        accountType: type,
        method: METHOD_BY_TYPE[type],
        bankAccountId: null,
      });
      continue;
    }
    for (const account of ofType) {
      choices.push({
        key: account.id,
        label: account.name,
        accountType: type,
        method: METHOD_BY_TYPE[type],
        bankAccountId: account.id,
      });
    }
  }
  return choices;
}

export function PaymentAccountPicker({
  choices,
  value,
  onChange,
}: {
  choices: PaymentChoice[];
  value: string;
  onChange: (choice: PaymentChoice) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {choices.map((choice) => {
        const Icon = ICONS[choice.accountType];
        const selected = choice.key === value;
        return (
          <button
            key={choice.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(choice)}
            className={cn(
              "flex min-h-14 items-center gap-2 rounded-md border px-3 py-2 text-start text-sm font-medium transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted"
            )}
          >
            <Icon className="size-5 shrink-0" />
            <span className="min-w-0 break-words">{choice.label}</span>
          </button>
        );
      })}
    </div>
  );
}

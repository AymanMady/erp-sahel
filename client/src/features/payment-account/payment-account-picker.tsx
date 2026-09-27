/**
 * "How is it paid?" — only two ways: cash or a banking app. When several banking apps
 * (Bankily, Masrvi, Sedad…) or several cash drawers exist, a second row asks which one;
 * the payment method follows from the kind of account.
 */

import { IconCash, IconDeviceMobile } from "@tabler/icons-react";
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

/** Bank accounts are not offered: a payment is either cash or a banking app. */
const TYPE_ORDER: BankAccountType[] = ["CASH", "MOBILE_MONEY"];

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
  const { t } = useTranslation("banking");
  const selected = choices.find((choice) => choice.key === value);
  const selectedType = selected?.accountType === "CASH" ? "CASH" : "MOBILE_MONEY";
  const groups = [
    { type: "CASH" as const, label: t("picker.cash"), icon: IconCash },
    { type: "MOBILE_MONEY" as const, label: t("picker.bankApp"), icon: IconDeviceMobile },
  ]
    .map((group) => ({
      ...group,
      choices: choices.filter((choice) =>
        group.type === "CASH" ? choice.accountType === "CASH" : choice.accountType !== "CASH"
      ),
    }))
    .filter((group) => group.choices.length > 0);
  const subChoices = groups.find((group) => group.type === selectedType)?.choices ?? [];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {groups.map((group) => {
          const Icon = group.icon;
          const active = selected ? group.type === selectedType : false;
          return (
            <button
              key={group.type}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (!active) onChange(group.choices[0]);
              }}
              className={cn(
                "flex min-h-14 items-center gap-2 rounded-md border px-3 py-2 text-start text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              )}
            >
              <Icon className="size-5 shrink-0" />
              <span className="min-w-0 break-words">{group.label}</span>
            </button>
          );
        })}
      </div>
      {subChoices.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {subChoices.map((choice) => {
            const active = choice.key === value;
            return (
              <button
                key={choice.key}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(choice)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "bg-background hover:bg-muted"
                )}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

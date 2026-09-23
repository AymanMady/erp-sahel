/**
 * Saisie d'un montant.
 *
 * L'état interne est une chaîne pour laisser l'utilisateur taper « 1 250,50 » sans que
 * le champ ne se reformate à chaque frappe ; la valeur remontée est toujours un
 * **entier en centimes** ([BR-22] et `shared/money.ts`).
 */

import { useEffect, useState } from "react";

import { centsToMajor, parseAmountToCents, parsePercentToBp, bpToPercent } from "@shared/money";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";

export function MoneyInput({
  valueCents,
  onChange,
  id,
  disabled,
  className,
  placeholder = "0,00",
}: {
  valueCents: number;
  onChange: (cents: number) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => formatForEdit(valueCents));

  // Resynchronise quand la valeur change en dehors du champ (prix repris du catalogue).
  useEffect(() => {
    setText((current) =>
      parseAmountToCents(current) === valueCents ? current : formatForEdit(valueCents)
    );
  }, [valueCents]);

  return (
    <Input
      id={id}
      inputMode="decimal"
      disabled={disabled}
      className={cn("tabular text-end", className)}
      placeholder={placeholder}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseAmountToCents(event.target.value));
      }}
      onBlur={() => setText(formatForEdit(parseAmountToCents(text)))}
    />
  );
}

function formatForEdit(cents: number): string {
  if (!cents) return "";
  return centsToMajor(cents).toFixed(2).replace(".", ",");
}

/** Saisie d'un taux (TVA, remise) exprimé en pourcentage, renvoyé en points de base. */
export function RateInput({
  valueBp,
  onChange,
  id,
  disabled,
  className,
}: {
  valueBp: number;
  onChange: (bp: number) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(() =>
    valueBp ? String(bpToPercent(valueBp)).replace(".", ",") : ""
  );

  useEffect(() => {
    setText((current) =>
      parsePercentToBp(current) === valueBp
        ? current
        : valueBp
          ? String(bpToPercent(valueBp)).replace(".", ",")
          : ""
    );
  }, [valueBp]);

  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        disabled={disabled}
        className={cn("tabular pe-7 text-end", className)}
        placeholder="0"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(parsePercentToBp(event.target.value));
        }}
      />
      <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        %
      </span>
    </div>
  );
}

/** Saisie de quantité (jusqu'à 3 décimales). */
export function QuantityInput({
  value,
  onChange,
  id,
  disabled,
  className,
}: {
  value: string | number;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Input
      id={id}
      inputMode="decimal"
      disabled={disabled}
      className={cn("tabular text-end", className)}
      value={String(value)}
      onChange={(event) => onChange(event.target.value.replace(",", "."))}
    />
  );
}

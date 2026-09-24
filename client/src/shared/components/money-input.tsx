/**
 * Amount input.
 *
 * The internal state is a string so the user can type "1 250,50" without the field
 * reformatting on every keystroke; the value reported upward is always an **integer
 * number of cents** ([BR-22] and `shared/money.ts`).
 *
 * Both "," and "." are accepted as the decimal separator; the value is re-displayed
 * with the separator of the UI language.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { centsToMajor, parseAmountToCents, parsePercentToBp, bpToPercent } from "@shared/money";
import { currentIntlLocale } from "@/shared/i18n";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";

export function MoneyInput({
  valueCents,
  onChange,
  id,
  disabled,
  className,
  placeholder,
}: {
  valueCents: number;
  onChange: (cents: number) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  useTranslation();
  const [text, setText] = useState(() => formatForEdit(valueCents));

  // Resynchronize when the value changes outside the field (price taken from the catalog).
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
      placeholder={placeholder ?? `0${decimalSeparator()}00`}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseAmountToCents(event.target.value));
      }}
      onBlur={() => setText(formatForEdit(parseAmountToCents(text)))}
    />
  );
}

/** Decimal separator of the UI language ("," in French, "." in English). */
function decimalSeparator(): string {
  const part = new Intl.NumberFormat(currentIntlLocale())
    .formatToParts(1.5)
    .find((entry) => entry.type === "decimal");
  return part?.value ?? ".";
}

function formatForEdit(cents: number): string {
  if (!cents) return "";
  return centsToMajor(cents).toFixed(2).replace(".", decimalSeparator());
}

function formatPercentForEdit(bp: number): string {
  return bp ? String(bpToPercent(bp)).replace(".", decimalSeparator()) : "";
}

/** Rate input (VAT, discount) expressed as a percentage, reported in basis points. */
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
  const [text, setText] = useState(() => formatPercentForEdit(valueBp));

  useEffect(() => {
    setText((current) =>
      parsePercentToBp(current) === valueBp ? current : formatPercentForEdit(valueBp)
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

/** Quantity input (up to 3 decimals). */
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

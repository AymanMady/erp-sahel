/** Phone field: digits only, 8 digits starting with 2, 3 or 4 (empty allowed). */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { isValidPhone } from "@shared/phone";
import { Field } from "@/shared/components/field";
import { Input } from "@/shared/ui/input";

export function PhoneField({
  id,
  value,
  onChange,
  label,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation("common");
  const [touched, setTouched] = useState(false);
  const invalid = !isValidPhone(value);

  return (
    <Field
      label={label ?? t("labels.phone")}
      htmlFor={id}
      className={className}
      hint={t("phone.hint")}
      error={invalid && (touched || value.length >= 8) ? t("phone.invalid") : null}
    >
      <Input
        id={id}
        dir="ltr"
        inputMode="numeric"
        autoComplete="tel"
        maxLength={8}
        value={value}
        aria-invalid={invalid && touched}
        onBlur={() => setTouched(true)}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 8))}
      />
    </Field>
  );
}

/** Company logo, name and currency, in place of the template's `.logo-src` image. */

import { useTranslation } from "react-i18next";

import { useSession } from "@/shared/auth/session";
import { brandIcon as BrandIcon } from "@/shared/config/nav";

export function CompanyBrand() {
  const { company } = useSession();
  const { t } = useTranslation("layout");

  return (
    <div className="app-brand">
      <span className="app-brand__icon">
        {company?.logo ? <img src={company.logo} alt="" /> : <BrandIcon size={20} />}
      </span>
      <span className="app-brand__text">
        <span className="truncate">{company?.name ?? t("common:appName")}</span>
        <small className="truncate">
          {company
            ? t("companyBrand.currency", { currency: company.currency })
            : t("common:states.loading")}
        </small>
      </span>
    </div>
  );
}

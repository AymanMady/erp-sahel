/** Footer, with the ArchitectUI template markup (`AppFooter/footer.hbs`). */

import { useTranslation } from "react-i18next";
import { Link } from "wouter";

import { useSession } from "@/shared/auth/session";
import type { SyncStatus } from "@/shared/offline/sync-engine";
import { useOnline } from "@/shared/hooks/use-online";

export function AppFooter({ syncStatus }: { syncStatus: SyncStatus }) {
  const { company } = useSession();
  const online = useOnline();
  const { t } = useTranslation("layout");

  const tone = !online
    ? "bg-warning"
    : syncStatus.failed > 0
      ? "bg-danger"
      : syncStatus.pending > 0
        ? "bg-info"
        : "bg-success";
  const label = !online
    ? t("sync.offline")
    : syncStatus.failed > 0
      ? t("sync.errors", { count: syncStatus.failed })
      : syncStatus.pending > 0
        ? t("sync.pendingCount", { count: syncStatus.pending })
        : t("sync.upToDate");

  return (
    <div className="app-wrapper-footer print-hidden">
      <div className="app-footer">
        <div className="app-footer__inner">
          <div className="app-footer-left">
            <ul className="nav">
              <li className="nav-item">
                <span className="nav-link text-secondary">
                  © {new Date().getFullYear()} {company?.name ?? t("common:appName")}
                </span>
              </li>
            </ul>
          </div>
          <div className="app-footer-right">
            <ul className="nav">
              <li className="nav-item">
                <Link href="/sync" className="nav-link">
                  <span className={`badge ${tone}`}>{label}</span>
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

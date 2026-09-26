/**
 * User widget of the header, with the ArchitectUI template markup
 * (`AppHeader/Components/header-right.hbs`): avatar with its menu, name and login.
 */

import { useState } from "react";
import { IconChevronDown, IconLogout, IconSettings, IconUserCircle } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Link } from "wouter";

import { initials } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { useSession } from "@/shared/auth/session";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

export function HeaderUser() {
  const { user, logout } = useSession();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const { t } = useTranslation("layout");

  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username || "";

  const handleLogout = async () => {
    setSigningOut(true);
    try {
      await logout();
      queryClient.clear();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="header-btn-lg pe-0">
      <div className="widget-content p-0">
        <div className="widget-content-wrapper">
          <div className="widget-content-left">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="p-0 btn d-flex align-items-center">
                  {user?.avatarUrl ? (
                    <img
                      width={42}
                      height={42}
                      className="rounded-circle"
                      src={user.avatarUrl}
                      alt=""
                    />
                  ) : (
                    <span className="header-avatar">{initials(fullName)}</span>
                  )}
                  <IconChevronDown size={14} className="ms-2 opacity-75" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-semibold">{fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user?.email || user?.username}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <IconUserCircle className="size-4" />
                    {t("userMenu.profile")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/company">
                    <IconSettings className="size-4" />
                    {t("userMenu.settings")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={signingOut}
                  onClick={() => void handleLogout()}
                >
                  <IconLogout className="size-4" />
                  {t("userMenu.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="widget-content-left ms-3 header-user-info">
            <div className="widget-heading">{fullName}</div>
            <div className="widget-subheading">{user?.email || user?.username}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

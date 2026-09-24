/**
 * Roles and permissions.
 *
 * System roles are read-only: editing them over time would make security drift from
 * one company to another. To adapt one, create a new role.
 */

import { useState } from "react";
import { IconLock, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { PERMISSIONS, type PermissionCode } from "@shared/rbac";
import { errorMessage } from "@/shared/api/api-error";
import { settingsApi } from "@/entities/settings/api";
import type { RoleWithPermissions } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { permissionLabel, roleDescription, roleName } from "@/shared/lib/i18n-labels";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Skeleton } from "@/shared/ui/skeleton";
import { Textarea } from "@/shared/ui/textarea";

/** Permissions grouped by domain, for a readable list (`labelKey` in `roles:groups`). */
const PERMISSION_GROUPS: { labelKey: string; prefixes: string[] }[] = [
  { labelKey: "masterData", prefixes: ["parties", "catalog", "services"] },
  {
    labelKey: "operations",
    prefixes: ["inventory", "purchasing", "sales", "invoicing", "payments", "banking", "pos"],
  },
  { labelKey: "accountingReporting", prefixes: ["accounting", "reports"] },
  { labelKey: "administration", prefixes: ["settings", "users", "modules", "audit"] },
];

export default function RolesSettingsPage() {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const { t } = useTranslation("settings");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RoleWithPermissions | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => settingsApi.listRoles(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => settingsApi.deleteRole(id),
    onSuccess: () => {
      toast.success(t("roles.deleted"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-6">
      <PageHeader title={t("roles.title")} description={t("roles.description")}>
        {can("users.write") ? (
          <Button onClick={() => setCreating(true)}>
            <IconPlus className="size-4" />
            {t("roles.new")}
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {roleName(role)}
                    {role.isSystem ? <IconLock className="size-3.5 text-muted-foreground" /> : null}
                  </CardTitle>
                  <CardDescription>{roleDescription(role)}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("roles.permissionCount", { count: role.permissions.length })}
              </p>
              <div className="flex flex-wrap gap-1">
                {role.permissions.slice(0, 6).map((permission) => (
                  <Badge
                    key={permission}
                    variant="outline"
                    className="text-[10px]"
                    title={permissionLabel(permission)}
                  >
                    {permission}
                  </Badge>
                ))}
                {role.permissions.length > 6 ? (
                  <Badge variant="secondary" className="text-[10px]">
                    +{role.permissions.length - 6}
                  </Badge>
                ) : null}
              </div>
              {can("users.write") ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(role)}>
                    {role.isSystem ? t("common:actions.view") : t("common:actions.edit")}
                  </Button>
                  {!role.isSystem ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("common:actions.delete")}
                      onClick={() => remove.mutate(role.id)}
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <RoleDialog
        open={creating || editing !== null}
        onOpenChange={(value) => {
          if (!value) {
            setCreating(false);
            setEditing(null);
          }
        }}
        role={editing}
      />
    </div>
  );
}

function RoleDialog({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: RoleWithPermissions | null;
}) {
  const queryClient = useQueryClient();
  const { t } = useTranslation("settings");
  const [form, setForm] = useState({ name: "", description: "", permissions: [] as string[] });

  const key = role?.id ?? "new";
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setForm({
      name: role ? roleName(role) : "",
      description: role ? roleDescription(role) : "",
      permissions: role?.permissions ?? [],
    });
  }

  const readOnly = role?.isSystem ?? false;

  const mutation = useMutation({
    mutationFn: () => (role ? settingsApi.updateRole(role.id, form) : settingsApi.createRole(form)),
    onSuccess: () => {
      toast.success(role ? t("roles.updated") : t("roles.created"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggle = (code: string) =>
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(code)
        ? current.permissions.filter((entry) => entry !== code)
        : [...current.permissions, code],
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {readOnly
              ? t("roles.dialog.systemTitle", { name: role ? roleName(role) : "" })
              : role
                ? t("roles.dialog.editTitle")
                : t("roles.new")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t("common:labels.name")} required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              disabled={readOnly}
            />
          </Field>
          <Field label={t("common:labels.description")}>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              disabled={readOnly}
            />
          </Field>

          <ScrollArea className="h-80 rounded-md border">
            <div className="space-y-4 p-4">
              {PERMISSION_GROUPS.map((group) => {
                const codes = (Object.keys(PERMISSIONS) as PermissionCode[]).filter((code) =>
                  group.prefixes.includes(code.split(".")[0])
                );
                if (codes.length === 0) return null;
                return (
                  <div key={group.labelKey} className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(`roles:groups.${group.labelKey}`)}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {codes.map((code) => (
                        <label key={code} className="flex items-start gap-2 text-sm">
                          <Checkbox
                            checked={form.permissions.includes(code)}
                            onCheckedChange={() => toggle(code)}
                            disabled={readOnly}
                            className="mt-0.5"
                          />
                          <span>
                            {permissionLabel(code)}
                            <span className="tabular block text-xs text-muted-foreground">
                              {code}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {readOnly ? t("common:actions.close") : t("common:actions.cancel")}
          </Button>
          {!readOnly ? (
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !form.name.trim()}
            >
              {t("common:actions.save")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

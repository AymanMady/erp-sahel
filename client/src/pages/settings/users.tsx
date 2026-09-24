/** Company user accounts and role assignment. */

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatDateTime, initials } from "@shared/format";
import { errorMessage, fieldErrors } from "@/shared/api/api-error";
import { settingsApi } from "@/entities/settings/api";
import type { UserWithRoles } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { roleName } from "@/shared/lib/i18n-labels";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";

export default function UsersSettingsPage() {
  const queryClient = useQueryClient();
  const { can, user: currentUser } = useSession();
  const { t } = useTranslation("settings");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserWithRoles | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.users,
    queryFn: () => settingsApi.listUsers(),
  });
  const { data: roles } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => settingsApi.listRoles(),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      settingsApi.updateUser(id, { isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const columns: Column<UserWithRoles>[] = [
    {
      id: "user",
      header: t("users.columns.user"),
      cell: (row) => (
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback>
              {initials(`${row.firstName} ${row.lastName}`) || initials(row.username)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">
              {[row.firstName, row.lastName].filter(Boolean).join(" ") || row.username}
            </p>
            <p className="tabular text-xs text-muted-foreground">{row.username}</p>
          </div>
        </div>
      ),
    },
    {
      id: "roles",
      header: t("users.columns.roles"),
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.roles.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t("users.noRole")}</span>
          ) : (
            row.roles.map((role) => (
              <Badge key={role.id} variant="outline">
                {roleName(role)}
              </Badge>
            ))
          )}
        </div>
      ),
    },
    {
      id: "offline",
      header: t("users.columns.offlineLogin"),
      align: "center",
      hideOnMobile: true,
      cell: (row) => (row.allowOfflineLogin ? t("users.allowed") : "—"),
    },
    {
      id: "lastLogin",
      header: t("users.columns.lastLogin"),
      hideOnMobile: true,
      cell: (row) => (row.lastLoginAt ? formatDateTime(row.lastLoginAt) : t("users.never")),
    },
    {
      id: "active",
      header: t("common:labels.active"),
      align: "center",
      cell: (row) => (
        <Switch
          checked={row.isActive}
          disabled={!can("users.write") || row.id === currentUser?.id}
          onCheckedChange={(checked) => toggleActive.mutate({ id: row.id, isActive: checked })}
          aria-label={t("users.activateAccount")}
        />
      ),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) =>
        can("users.write") ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
            {t("common:actions.edit")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("users.title")} description={t("users.description")}>
        {can("users.write") ? (
          <Button onClick={() => setCreating(true)}>
            <IconPlus className="size-4" />
            {t("users.new")}
          </Button>
        ) : null}
      </PageHeader>

      <ResourceTable
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("users.emptyTitle")}
        emptyDescription={t("users.emptyDescription")}
        minWidthClassName="min-w-[900px]"
      />

      <UserDialog
        open={creating || editing !== null}
        onOpenChange={(value) => {
          if (!value) {
            setCreating(false);
            setEditing(null);
          }
        }}
        user={editing}
        roles={(roles ?? []).map((role) => ({ id: role.id, name: roleName(role) }))}
      />
    </div>
  );
}

function UserDialog({
  open,
  onOpenChange,
  user,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserWithRoles | null;
  roles: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const { t } = useTranslation("settings");
  const [form, setForm] = useState({
    username: "",
    password: "",
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    allowOfflineLogin: true,
    roleIds: [] as string[],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const key = user?.id ?? "new";
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setForm({
      username: user?.username ?? "",
      password: "",
      email: user?.email ?? "",
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      phone: user?.phone ?? "",
      allowOfflineLogin: user?.allowOfflineLogin ?? true,
      roleIds: user?.roles.map((role) => role.id) ?? [],
    });
    setErrors({});
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (user) {
        const { username: _username, password, ...patch } = form;
        return settingsApi.updateUser(user.id, password ? { ...patch, password } : patch);
      }
      return settingsApi.createUser(form);
    },
    onSuccess: () => {
      toast.success(user ? t("users.updated") : t("users.created"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
      onOpenChange(false);
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      toast.error(errorMessage(error));
    },
  });

  const toggleRole = (roleId: string) =>
    setForm((current) => ({
      ...current,
      roleIds: current.roleIds.includes(roleId)
        ? current.roleIds.filter((id) => id !== roleId)
        : [...current.roleIds, roleId],
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user ? t("users.dialog.editTitle") : t("users.new")}</DialogTitle>
          <DialogDescription>{t("users.dialog.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FieldGrid>
            <Field label={t("users.dialog.username")} required error={errors.username}>
              <Input
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
                required
                disabled={Boolean(user)}
                className="tabular"
              />
            </Field>
            <Field
              label={user ? t("users.dialog.newPassword") : t("users.dialog.password")}
              required={!user}
              error={errors.password}
              hint={user ? t("users.dialog.keepPasswordHint") : t("users.dialog.passwordHint")}
            >
              <Input
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                required={!user}
              />
            </Field>
            <Field label={t("users.dialog.firstName")}>
              <Input
                value={form.firstName}
                onChange={(event) => setForm({ ...form, firstName: event.target.value })}
              />
            </Field>
            <Field label={t("users.dialog.lastName")}>
              <Input
                value={form.lastName}
                onChange={(event) => setForm({ ...form, lastName: event.target.value })}
              />
            </Field>
            <Field label={t("common:labels.email")} error={errors.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
            <Field label={t("common:labels.phone")}>
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </Field>
          </FieldGrid>

          <Field label={t("users.columns.roles")}>
            <div className="space-y-2 rounded-md border p-3">
              {roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.roleIds.includes(role.id)}
                    onCheckedChange={() => toggleRole(role.id)}
                  />
                  {role.name}
                </label>
              ))}
            </div>
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.allowOfflineLogin}
              onCheckedChange={(checked) =>
                setForm({ ...form, allowOfflineLogin: checked === true })
              }
            />
            {t("users.dialog.allowOffline")}
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending || !form.username.trim()}>
              {t("common:actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

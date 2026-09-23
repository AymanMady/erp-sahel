/** Comptes utilisateurs de la société et affectation des rôles. */

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { formatDateTime, initials } from "@shared/format";
import { errorMessage, fieldErrors } from "@/shared/api/api-error";
import { settingsApi } from "@/entities/settings/api";
import type { UserWithRoles } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
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
      header: "Utilisateur",
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
      header: "Rôles",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.roles.length === 0 ? (
            <span className="text-sm text-muted-foreground">aucun</span>
          ) : (
            row.roles.map((role) => (
              <Badge key={role.id} variant="outline">
                {role.name}
              </Badge>
            ))
          )}
        </div>
      ),
    },
    {
      id: "offline",
      header: "Connexion hors ligne",
      align: "center",
      hideOnMobile: true,
      cell: (row) => (row.allowOfflineLogin ? "Autorisée" : "—"),
    },
    {
      id: "lastLogin",
      header: "Dernière connexion",
      hideOnMobile: true,
      cell: (row) => (row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "jamais"),
    },
    {
      id: "active",
      header: "Actif",
      align: "center",
      cell: (row) => (
        <Switch
          checked={row.isActive}
          disabled={!can("users.write") || row.id === currentUser?.id}
          onCheckedChange={(checked) => toggleActive.mutate({ id: row.id, isActive: checked })}
          aria-label="Activer le compte"
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
            Modifier
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Utilisateurs"
        description="Comptes rattachés à cette société et rôles qui leur sont affectés."
      >
        {can("users.write") ? (
          <Button onClick={() => setCreating(true)}>
            <IconPlus className="size-4" />
            Nouvel utilisateur
          </Button>
        ) : null}
      </PageHeader>

      <ResourceTable
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucun utilisateur"
        emptyDescription="Créez des comptes pour vos vendeurs, magasiniers et comptables."
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
        roles={(roles ?? []).map((role) => ({ id: role.id, name: role.name }))}
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
      toast.success(user ? "Utilisateur mis à jour." : "Utilisateur créé.");
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
          <DialogTitle>{user ? "Modifier l'utilisateur" : "Nouvel utilisateur"}</DialogTitle>
          <DialogDescription>
            Les rôles affectés ne valent que pour la société courante.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FieldGrid>
            <Field label="Identifiant" required error={errors.username}>
              <Input
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
                required
                disabled={Boolean(user)}
                className="tabular"
              />
            </Field>
            <Field
              label={user ? "Nouveau mot de passe" : "Mot de passe"}
              required={!user}
              error={errors.password}
              hint={
                user ? "Laisser vide pour ne pas modifier." : "8 caractères, lettres et chiffres."
              }
            >
              <Input
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                required={!user}
              />
            </Field>
            <Field label="Prénom">
              <Input
                value={form.firstName}
                onChange={(event) => setForm({ ...form, firstName: event.target.value })}
              />
            </Field>
            <Field label="Nom">
              <Input
                value={form.lastName}
                onChange={(event) => setForm({ ...form, lastName: event.target.value })}
              />
            </Field>
            <Field label="E-mail" error={errors.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
            <Field label="Téléphone">
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </Field>
          </FieldGrid>

          <Field label="Rôles">
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
            Autoriser la connexion hors ligne sur un poste desktop synchronisé
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={mutation.isPending || !form.username.trim()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

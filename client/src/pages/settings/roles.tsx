/**
 * Rôles et permissions.
 *
 * Les rôles système sont en lecture seule : les modifier au fil de l'eau ferait dériver
 * la sécurité d'une société à l'autre. Pour les adapter, on en crée un nouveau.
 */

import { useState } from "react";
import { IconLock, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PERMISSIONS, type PermissionCode } from "@shared/rbac";
import { errorMessage } from "@/shared/api/api-error";
import { settingsApi } from "@/entities/settings/api";
import type { RoleWithPermissions } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Skeleton } from "@/shared/ui/skeleton";
import { Textarea } from "@/shared/ui/textarea";

/** Regroupement des permissions par domaine, pour une liste lisible. */
const PERMISSION_GROUPS: { label: string; prefixes: string[] }[] = [
  { label: "Référentiels", prefixes: ["parties", "catalog", "services"] },
  {
    label: "Opérations",
    prefixes: ["inventory", "purchasing", "sales", "invoicing", "payments", "banking", "pos"],
  },
  { label: "Comptabilité & pilotage", prefixes: ["accounting", "reports"] },
  { label: "Administration", prefixes: ["settings", "users", "modules", "audit"] },
  { label: "Modules métier", prefixes: ["auto_parts", "clothing", "market"] },
];

export default function RolesSettingsPage() {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RoleWithPermissions | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => settingsApi.listRoles(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => settingsApi.deleteRole(id),
    onSuccess: () => {
      toast.success("Rôle supprimé.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rôles & permissions"
        description="Le masquage côté interface est un confort ; l'autorisation est vérifiée à chaque appel serveur."
      >
        {can("users.write") ? (
          <Button onClick={() => setCreating(true)}>
            <IconPlus className="size-4" />
            Nouveau rôle
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
                    {role.name}
                    {role.isSystem ? <IconLock className="size-3.5 text-muted-foreground" /> : null}
                  </CardTitle>
                  <CardDescription>{role.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <span className="tabular font-medium text-foreground">
                  {role.permissions.length}
                </span>{" "}
                permission(s)
              </p>
              <div className="flex flex-wrap gap-1">
                {role.permissions.slice(0, 6).map((permission) => (
                  <Badge key={permission} variant="outline" className="text-[10px]">
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
                    {role.isSystem ? "Consulter" : "Modifier"}
                  </Button>
                  {!role.isSystem ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Supprimer"
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
  const [form, setForm] = useState({ name: "", description: "", permissions: [] as string[] });

  const key = role?.id ?? "new";
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setForm({
      name: role?.name ?? "",
      description: role?.description ?? "",
      permissions: role?.permissions ?? [],
    });
  }

  const readOnly = role?.isSystem ?? false;

  const mutation = useMutation({
    mutationFn: () => (role ? settingsApi.updateRole(role.id, form) : settingsApi.createRole(form)),
    onSuccess: () => {
      toast.success(role ? "Rôle mis à jour." : "Rôle créé.");
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
            {readOnly ? `Rôle système — ${role?.name}` : role ? "Modifier le rôle" : "Nouveau rôle"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Nom" required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              disabled={readOnly}
            />
          </Field>
          <Field label="Description">
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
                  <div key={group.label} className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
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
                            {PERMISSIONS[code]}
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
            {readOnly ? "Fermer" : "Annuler"}
          </Button>
          {!readOnly ? (
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !form.name.trim()}
            >
              Enregistrer
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

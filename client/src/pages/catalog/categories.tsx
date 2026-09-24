/** Catalog categories — simple tree with a single parent level. */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { errorMessage } from "@/shared/api/api-error";
import { catalogApi } from "@/entities/catalog/api";
import type { Category } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";

const NONE = "NONE";

export default function CategoriesPage() {
  const { t } = useTranslation("catalog");
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => catalogApi.listCategories(),
  });

  const archive = useMutation({
    mutationFn: (id: string) => catalogApi.archiveCategory(id),
    onSuccess: () => {
      toast.success(t("categories.archived"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const nameById = new Map((data ?? []).map((category) => [category.id, category.name]));

  const columns: Column<Category>[] = [
    {
      id: "name",
      header: t("common:labels.name"),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: "parent",
      header: t("categories.parent"),
      cell: (row) =>
        row.parentId ? (
          (nameById.get(row.parentId) ?? "—")
        ) : (
          <span className="text-muted-foreground">{t("categories.root")}</span>
        ),
    },
    {
      id: "description",
      header: t("common:labels.description"),
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.description || "—"}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) =>
        can("catalog.write") ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
              {t("common:actions.edit")}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("common:actions.archive")}
              onClick={() => archive.mutate(row.id)}
            >
              <IconTrash className="size-4" />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("categories.title")} description={t("categories.description")}>
        {can("catalog.write") ? (
          <Button onClick={() => setOpen(true)}>
            <IconPlus className="size-4" />
            {t("categories.new")}
          </Button>
        ) : null}
      </PageHeader>

      <ResourceTable
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("categories.emptyTitle")}
        emptyDescription={t("categories.emptyDescription")}
      />

      <CategoryDialog
        open={open || editing !== null}
        onOpenChange={(value) => {
          if (!value) {
            setOpen(false);
            setEditing(null);
          }
        }}
        category={editing}
        categories={data ?? []}
      />
    </div>
  );
}

function CategoryDialog({
  open,
  onOpenChange,
  category,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: Category | null;
  categories: Category[];
}) {
  const { t } = useTranslation("catalog");
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", parentId: NONE, description: "" });

  // Reset the form on every opening (creation or edit).
  const key = category?.id ?? "new";
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setForm({
      name: category?.name ?? "",
      parentId: category?.parentId ?? NONE,
      description: category?.description ?? "",
    });
  }

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        parentId: form.parentId === NONE ? null : form.parentId,
        description: form.description,
      };
      return category
        ? catalogApi.updateCategory(category.id, payload)
        : catalogApi.createCategory(payload);
    },
    onSuccess: () => {
      toast.success(category ? t("categories.updated") : t("categories.created"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      onOpenChange(false);
      setForm({ name: "", parentId: NONE, description: "" });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? t("categories.editTitle") : t("categories.new")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label={t("common:labels.name")} required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
              autoFocus
            />
          </Field>
          <Field label={t("categories.parent")}>
            <Select
              value={form.parentId}
              onValueChange={(value) => setForm({ ...form, parentId: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("categories.noneRoot")}</SelectItem>
                {categories
                  .filter((entry) => entry.id !== category?.id)
                  .map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("common:labels.description")}>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending || !form.name.trim()}>
              {t("common:actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

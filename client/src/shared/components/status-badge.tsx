/**
 * Document status pills.
 *
 * One label and one color per status, defined once: otherwise every screen would end
 * up translating "PARTIALLY_PAID" its own way. Labels live in the `status` namespace,
 * keyed by the status code, and are resolved at call time so they follow the UI
 * language.
 */

import { useTranslation } from "react-i18next";

import { i18n } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";

type Tone = "draft" | "info" | "pending" | "success" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  draft: "bg-status-draft-bg text-status-draft",
  info: "bg-status-info-bg text-status-info",
  pending: "bg-status-pending-bg text-status-pending",
  success: "bg-status-success-bg text-status-success",
  danger: "bg-status-danger-bg text-status-danger",
};

const STATUS_TONES: Record<string, Tone> = {
  // Commercial documents
  DRAFT: "draft",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "draft",
  CONVERTED: "success",
  CONFIRMED: "info",
  PROCESSING: "pending",
  SHIPPED: "info",
  DELIVERED: "success",
  INVOICED: "success",
  CANCELLED: "danger",
  VALIDATED: "info",
  PARTIALLY_PAID: "pending",
  PAID: "success",
  // Purchasing
  ORDERED: "info",
  PARTIALLY_RECEIVED: "pending",
  RECEIVED: "success",
  // Point of sale
  OPEN: "success",
  CLOSED: "draft",
  // Payments
  PENDING: "pending",
  // Synchronization
  created: "success",
  duplicate: "info",
  error: "danger",
  deferred: "pending",
  synced: "success",
  sending: "info",
  pending: "pending",
};

/** Translated label of `status:<group>.<code>`, or the raw code when unknown. */
function lookup(group: string, code: string): string {
  const key = `status:${group}.${code}`;
  return i18n.exists(key) ? i18n.t(key) : code;
}

export function statusLabel(status: string): string {
  return lookup("labels", status);
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  // Subscribes the badge to language changes.
  useTranslation("status");
  const tone = STATUS_TONES[status] ?? "draft";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

export function paymentMethodLabel(method: string): string {
  return lookup("paymentMethods", method);
}

export function movementLabel(type: string): string {
  return lookup("movements", type);
}

export function partyTypeLabel(type: string): string {
  return lookup("partyTypes", type);
}

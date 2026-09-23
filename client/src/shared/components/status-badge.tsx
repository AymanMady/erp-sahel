/**
 * Pastilles de statut des documents.
 *
 * Un libellé et une couleur par statut, définis une seule fois : sans cela, chaque
 * écran finirait par traduire « PARTIALLY_PAID » à sa façon.
 */

import { cn } from "@/shared/lib/utils";

type Tone = "draft" | "info" | "pending" | "success" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  draft: "bg-status-draft-bg text-status-draft",
  info: "bg-status-info-bg text-status-info",
  pending: "bg-status-pending-bg text-status-pending",
  success: "bg-status-success-bg text-status-success",
  danger: "bg-status-danger-bg text-status-danger",
};

const STATUS_MAP: Record<string, { label: string; tone: Tone }> = {
  // Documents commerciaux
  DRAFT: { label: "Brouillon", tone: "draft" },
  SENT: { label: "Envoyé", tone: "info" },
  ACCEPTED: { label: "Accepté", tone: "success" },
  REJECTED: { label: "Refusé", tone: "danger" },
  EXPIRED: { label: "Expiré", tone: "draft" },
  CONVERTED: { label: "Converti", tone: "success" },
  CONFIRMED: { label: "Confirmée", tone: "info" },
  PROCESSING: { label: "En préparation", tone: "pending" },
  SHIPPED: { label: "Expédiée", tone: "info" },
  DELIVERED: { label: "Livrée", tone: "success" },
  INVOICED: { label: "Facturée", tone: "success" },
  CANCELLED: { label: "Annulé", tone: "danger" },
  VALIDATED: { label: "Validée", tone: "info" },
  PARTIALLY_PAID: { label: "Partiellement payée", tone: "pending" },
  PAID: { label: "Payée", tone: "success" },
  // Achats
  ORDERED: { label: "Commandée", tone: "info" },
  PARTIALLY_RECEIVED: { label: "Partiellement reçue", tone: "pending" },
  RECEIVED: { label: "Reçue", tone: "success" },
  // Caisse
  OPEN: { label: "Ouverte", tone: "success" },
  CLOSED: { label: "Clôturée", tone: "draft" },
  // Règlements
  PENDING: { label: "En attente", tone: "pending" },
  // Synchronisation
  created: { label: "Créé", tone: "success" },
  duplicate: { label: "Doublon ignoré", tone: "info" },
  error: { label: "Erreur", tone: "danger" },
  deferred: { label: "Reporté", tone: "pending" },
  synced: { label: "Synchronisé", tone: "success" },
  sending: { label: "Envoi…", tone: "info" },
  pending: { label: "En attente", tone: "pending" },
};

export function statusLabel(status: string): string {
  return STATUS_MAP[status]?.label ?? status;
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const entry = STATUS_MAP[status] ?? { label: status, tone: "draft" as Tone };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[entry.tone],
        className
      )}
    >
      {entry.label}
    </span>
  );
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement",
  CHECK: "Chèque",
  CARD: "Carte",
  MOBILE_MONEY: "Mobile Money",
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

const MOVEMENT_LABELS: Record<string, string> = {
  IN: "Entrée",
  OUT: "Sortie",
  TRANSFER: "Transfert",
  ADJUSTMENT: "Ajustement",
  RETURN: "Retour",
};

export function movementLabel(type: string): string {
  return MOVEMENT_LABELS[type] ?? type;
}

const PARTY_TYPE_LABELS: Record<string, string> = {
  CUSTOMER: "Client",
  SUPPLIER: "Fournisseur",
  BOTH: "Client & fournisseur",
  PROSPECT: "Prospect",
};

export function partyTypeLabel(type: string): string {
  return PARTY_TYPE_LABELS[type] ?? type;
}

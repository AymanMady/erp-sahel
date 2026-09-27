/**
 * Layout of a printed ticket, independent of how it is printed.
 *
 * A ticket is a list of rows. Two renderers read it:
 *  - `drawTicket` — a picture for a ticket printer (`escpos.ts`), drawn by the webview
 *    so Arabic is shaped and right-to-left like on screen;
 *  - `printTicketHtml` — the usual print window, for an office printer or a browser.
 */

import { printerSettings, type PrinterSettings } from "@/shared/desktop/device-config";
import { isTauriDesktop, tauriCommand } from "@/shared/desktop/desktop";
import { currentDirection, currentLanguage, i18n } from "@/shared/i18n";
import { DOTS_PER_PAPER, escposJob, toBitmap } from "./escpos";

export type TicketRow =
  /** Shop name, larger. */
  | { kind: "title"; text: string }
  /** Centred line (address, thanks). */
  | { kind: "center"; text: string; bold?: boolean }
  | { kind: "text"; text: string; bold?: boolean }
  /** Label on the reading side, amount on the other. */
  | { kind: "pair"; left: string; right: string; bold?: boolean; big?: boolean }
  | { kind: "rule" }
  | { kind: "space" };

export interface TicketOptions {
  paperWidth: 58 | 80;
  direction: "ltr" | "rtl";
  lang: string;
}

// ─── Ticket printer (picture) ────────────────────────────────────────────────

const FONT_FAMILY = `"Segoe UI", "Noto Sans", "Noto Sans Arabic", Tahoma, Arial, sans-serif`;

/** Words that fit in `maxWidth`, line by line. A word longer than a line is cut. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    while (ctx.measureText(current).width > maxWidth && current.length > 1) {
      let cut = current.length - 1;
      while (cut > 1 && ctx.measureText(current.slice(0, cut)).width > maxWidth) cut--;
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/**
 * Draws the ticket at the printer's resolution. Two passes: measure the height, then
 * draw on a canvas of exactly that size.
 */
export function drawTicket(rows: TicketRow[], options: TicketOptions): HTMLCanvasElement {
  const width = DOTS_PER_PAPER[options.paperWidth];
  const base = options.paperWidth === 58 ? 20 : 24;
  const margin = 4;
  const inner = width - margin * 2;
  const rtl = options.direction === "rtl";
  const startX = rtl ? width - margin : margin;
  const endX = rtl ? margin : width - margin;
  const startAlign: CanvasTextAlign = rtl ? "right" : "left";
  const endAlign: CanvasTextAlign = rtl ? "left" : "right";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = 1;
  const measureCtx = canvas.getContext("2d");
  if (!measureCtx) throw new Error("Canvas unavailable");

  const font = (size: number, bold?: boolean) => `${bold ? "700" : "400"} ${size}px ${FONT_FAMILY}`;

  type Op = (ctx: CanvasRenderingContext2D, y: number) => void;
  const ops: { y: number; op: Op }[] = [];
  let y = margin;

  const setup = (ctx: CanvasRenderingContext2D, size: number, bold?: boolean) => {
    ctx.font = font(size, bold);
    ctx.direction = options.direction;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#000";
  };

  for (const row of rows) {
    if (row.kind === "space") {
      y += Math.round(base * 0.6);
      continue;
    }
    if (row.kind === "rule") {
      const at = y + Math.round(base * 0.4);
      ops.push({
        y: at,
        op: (ctx, top) => {
          ctx.setLineDash([6, 4]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(margin, top);
          ctx.lineTo(width - margin, top);
          ctx.stroke();
          ctx.setLineDash([]);
        },
      });
      y += Math.round(base * 0.9);
      continue;
    }

    const size =
      row.kind === "title"
        ? Math.round(base * 1.35)
        : row.kind === "pair" && row.big
          ? Math.round(base * 1.2)
          : base;
    const bold =
      row.kind === "title" || ("bold" in row && row.bold) || (row.kind === "pair" && row.big);
    const lineHeight = Math.round(size * 1.3);
    setup(measureCtx, size, bold);

    if (row.kind === "pair") {
      const rightWidth = measureCtx.measureText(row.right).width;
      const lines = wrap(measureCtx, row.left, Math.max(inner - rightWidth - base, inner / 3));
      lines.forEach((line, index) => {
        ops.push({
          y,
          op: (ctx, top) => {
            setup(ctx, size, bold);
            ctx.textAlign = startAlign;
            ctx.fillText(line, startX, top);
            // The amount goes on the last line of its label.
            if (index === lines.length - 1) {
              ctx.textAlign = endAlign;
              ctx.fillText(row.right, endX, top);
            }
          },
        });
        y += lineHeight;
      });
      continue;
    }

    const centred = row.kind === "title" || row.kind === "center";
    for (const line of wrap(measureCtx, row.text, inner)) {
      ops.push({
        y,
        op: (ctx, top) => {
          setup(ctx, size, bold);
          ctx.textAlign = centred ? "center" : startAlign;
          ctx.fillText(line, centred ? width / 2 : startX, top);
        },
      });
      y += lineHeight;
    }
  }

  canvas.height = y + margin;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#000";
  for (const { y: top, op } of ops) op(ctx, top);
  return canvas;
}

/** Prints straight to the ticket printer, through the desktop shell. */
export async function printTicketDirect(
  rows: TicketRow[],
  options: TicketOptions & { target: string; openDrawer: boolean }
): Promise<void> {
  const canvas = drawTicket(rows, options);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const job = escposJob(toBitmap(data, canvas.width, canvas.height), {
    openDrawer: options.openDrawer,
  });
  await tauriCommand<void>("printer_send", { target: options.target, data: Array.from(job) });
}

// ─── Print window (HTML) ─────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ticketHtml(rows: TicketRow[], options: TicketOptions): string {
  const body = rows
    .map((row) => {
      switch (row.kind) {
        case "title":
          return `<div class="title">${escapeHtml(row.text)}</div>`;
        case "center":
          return `<div class="center${row.bold ? " bold" : ""}">${escapeHtml(row.text)}</div>`;
        case "text":
          return `<div${row.bold ? ' class="bold"' : ""}>${escapeHtml(row.text)}</div>`;
        case "pair":
          return `<div class="pair${row.bold || row.big ? " bold" : ""}${row.big ? " big" : ""}"><span>${escapeHtml(row.left)}</span><span class="amount">${escapeHtml(row.right)}</span></div>`;
        case "rule":
          return `<hr>`;
        case "space":
          return `<div class="space"></div>`;
      }
    })
    .join("");
  const paper = options.paperWidth === 58 ? "58mm" : "80mm";
  const printable = options.paperWidth === 58 ? "48mm" : "72mm";
  return `<!doctype html><html lang="${escapeHtml(options.lang)}" dir="${options.direction}"><head><meta charset="utf-8"><title>Ticket</title><style>
@page { size: ${paper} auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 2mm 0; width: ${printable}; font: 12px/1.35 ${FONT_FAMILY}; color: #000; background: #fff; }
.title { font-size: 16px; font-weight: 700; text-align: center; }
.center { text-align: center; }
.bold { font-weight: 700; }
.big { font-size: 14px; }
.pair { display: flex; justify-content: space-between; gap: 8px; }
.amount { white-space: nowrap; }
hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
.space { height: 6px; }
</style></head><body>${body}</body></html>`;
}

/**
 * Opens the usual print window with the ticket, from a hidden frame: the screen behind
 * does not move, and the frame is removed once printing is done.
 */
export function printTicketHtml(rows: TicketRow[], options: TicketOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0;";
    document.body.appendChild(frame);
    const view = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!view || !doc) {
      frame.remove();
      reject(new Error("Print window unavailable"));
      return;
    }
    doc.open();
    doc.write(ticketHtml(rows, options));
    doc.close();
    const cleanup = () => {
      setTimeout(() => frame.remove(), 1000);
      resolve();
    };
    view.addEventListener("afterprint", cleanup, { once: true });
    // Let the frame lay the ticket out before printing.
    setTimeout(() => {
      try {
        view.focus();
        view.print();
      } catch (error) {
        frame.remove();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      // Some webviews never fire `afterprint`: clean up anyway.
      setTimeout(cleanup, 60_000);
    }, 50);
  });
}

// ─── Choice of the method ────────────────────────────────────────────────────

/**
 * Prints with this workstation's settings: straight to the ticket printer when it is
 * set up (desktop), otherwise through the usual print window.
 */
export async function printTicket(
  rows: TicketRow[],
  settings: PrinterSettings = printerSettings()
): Promise<void> {
  const options: TicketOptions = {
    paperWidth: settings.paperWidth,
    direction: currentDirection(),
    lang: currentLanguage(),
  };
  if (isTauriDesktop() && settings.mode === "direct") {
    await printTicketDirect(rows, {
      ...options,
      target: settings.target,
      openDrawer: settings.openDrawer,
    });
    return;
  }
  await printTicketHtml(rows, options);
}

/** A short ticket to check the printer, the paper width and the language. */
export function testTicketRows(): TicketRow[] {
  const t = i18n.getFixedT(null, "device");
  return [
    { kind: "title", text: t("printer.testTitle") },
    { kind: "rule" },
    { kind: "text", text: t("printer.testBody") },
    { kind: "pair", left: "123456789", right: "0123456789" },
    { kind: "rule" },
    { kind: "center", text: new Date().toLocaleString(currentLanguage()) },
    { kind: "space" },
  ];
}

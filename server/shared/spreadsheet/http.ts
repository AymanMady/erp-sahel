/** HTTP side of Excel files: reading an upload, sending a download. */

import express, { type Response } from "express";

import { todayInput } from "@shared/format";
import { XLSX_CONTENT_TYPE } from "./workbook";

/**
 * The file is sent as the raw request body (no form encoding). Whatever its declared
 * type, it is read as bytes; `readWorkbook` then rejects what is not an Excel file.
 */
export const workbookUpload = express.raw({ type: () => true, limit: "10mb" });

/** Sends a workbook as a download named `<name>-<date>.xlsx`. */
export function sendWorkbook(res: Response, name: string, buffer: Buffer): void {
  const fileName = `${name}-${todayInput()}.xlsx`;
  // The plain name keeps only safe characters; `filename*` carries the translated one.
  const asciiName = fileName.normalize("NFD").replace(/[^\w.-]+/g, "_");
  res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
}

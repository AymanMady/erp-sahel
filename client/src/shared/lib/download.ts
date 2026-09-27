/** Hands a file produced by the app (Excel export…) to the browser as a download. */
export function saveFile(file: Blob, fileName: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked later: some browsers start reading the file after `click()` returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

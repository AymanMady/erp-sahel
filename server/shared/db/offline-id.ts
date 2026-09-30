/**
 * Primary key of a row created from an offline operation: the operation's `client_uuid`.
 *
 * The workstation stored the row under that id before sending it; keeping it on the
 * server means the row has the same id everywhere, and later operations on it
 * (update, payment of an invoice…) can name it before the first one is acknowledged.
 * Without a `client_uuid` (online entry), the database draws the id as before.
 */
export function offlineId(clientUuid: string | null | undefined): { id?: string } {
  return clientUuid ? { id: clientUuid } : {};
}

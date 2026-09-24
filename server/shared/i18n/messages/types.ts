/** A translation table: English source message ⇒ translated message. */
export type MessageTable = Record<string, string>;

export interface MessageCatalog {
  fr: MessageTable;
  ar: MessageTable;
}

/**
 * What the app asks storage for. Deliberately narrow: features say "give me an
 * upload target for this object" and never learn the bucket name, the URL
 * lifetime, or which provider is behind it.
 */

export type SignedUpload = {
  /** Where the browser PUTs the bytes. Single use, short lived. */
  url: string;
  /** Supabase's upload token, required alongside the URL. */
  token: string;
  /** The path the object will occupy. Stored on the page row. */
  storageKey: string;
};

export type SignedRead = {
  url: string;
  /** When the URL stops working, so callers can decide whether to re-sign. */
  expiresAt: Date;
};

export class StorageError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "StorageError";
  }
}

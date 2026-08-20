import { createClient } from "@supabase/supabase-js";

import { publicEnv } from "@/config/env.public";
import { serverEnv } from "@/config/env.server";

import { StorageError, type SignedRead, type SignedUpload } from "./storage.types";

/**
 * Supabase Storage, reached with the secret key.
 *
 * Unlike `features/auth/supabase-server.ts`, this client is a module-level
 * singleton and that is safe: it carries no user session, so there is nothing
 * belonging to one request that could leak into the next. `persistSession` is
 * off for the same reason — there is no session to persist and no cookie jar to
 * put it in.
 *
 * The secret key bypasses row level security. That is the point: the bucket is
 * private and `storage.objects` denies everything by default, so nothing else
 * could issue a URL. The key is never the authorization — every caller in this
 * app has already established ownership before reaching this file.
 */
const storage = createClient(
  publicEnv.NEXT_PUBLIC_SUPABASE_URL,
  serverEnv.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
).storage.from(serverEnv.SUPABASE_STORAGE_BUCKET);

/**
 * How long a read URL stays valid.
 *
 * Long enough to open a page and look at it, short enough that a URL copied out
 * of devtools and pasted elsewhere stops working quickly. Every page view signs
 * fresh URLs, so there is no benefit to a longer window.
 */
const READ_URL_TTL_SECONDS = 300;

/**
 * A URL the browser can PUT an image to, without the bytes passing through this
 * app. On a serverless free tier that is not a nicety: a 10 MB upload through a
 * function would burn execution time and memory for no reason, and some
 * platforms cap request bodies well below that.
 */
export async function createSignedUpload(
  storageKey: string,
): Promise<SignedUpload> {
  const { data, error } = await storage.createSignedUploadUrl(storageKey);

  if (error || !data) {
    throw new StorageError("Could not create an upload URL.", { cause: error });
  }

  return { url: data.signedUrl, token: data.token, storageKey };
}

/** A short-lived URL for reading one private object. */
export async function createSignedRead(
  storageKey: string,
): Promise<SignedRead> {
  const { data, error } = await storage.createSignedUrl(
    storageKey,
    READ_URL_TTL_SECONDS,
  );

  if (error || !data) {
    throw new StorageError("Could not create a read URL.", { cause: error });
  }

  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + READ_URL_TTL_SECONDS * 1000),
  };
}

/**
 * Whether an object is really there.
 *
 * Used before writing a page row: the browser uploads directly, so "the upload
 * succeeded" is the browser's word for it until we check. Without this, a
 * failed or abandoned upload could still produce a row pointing at nothing.
 */
export async function objectExists(storageKey: string): Promise<boolean> {
  const { data, error } = await storage.exists(storageKey);

  // A missing object comes back as `data: false` *with* an error attached,
  // because Supabase answers the underlying HEAD with a 400. That is the answer
  // to the question, not a failure, and treating it as one turned "that upload
  // did not finish" into "storage is down" — which tells the user to wait when
  // they should retry.
  if (error && !isObjectNotFound(error)) {
    throw new StorageError("Could not check whether the file exists.", {
      cause: error,
    });
  }

  return data === true;
}

/** 400 and 404 both mean "not there" from Supabase's object endpoints. */
function isObjectNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }

  const status = (error as { status: unknown }).status;

  return status === 400 || status === 404;
}

/** Remove an object. Used when a page row is deleted, and to sweep orphans. */
export async function removeObject(storageKey: string): Promise<void> {
  const { error } = await storage.remove([storageKey]);

  if (error) {
    throw new StorageError("Could not delete the file.", { cause: error });
  }
}

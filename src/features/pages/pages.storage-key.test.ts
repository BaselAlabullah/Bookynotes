import { describe, expect, it } from "vitest";

import { asBookId, asUserId } from "@/db/ids";

import {
  ACCEPTED_CONTENT_TYPES,
  buildStorageKey,
  flattenedKeyFor,
  isStorageKeyOwnedBy,
  revisedFlattenedKeyFor,
} from "./pages.storage-key";

/**
 * These are ownership checks, not formatting helpers.
 *
 * The browser uploads straight to Supabase and then tells the server where it
 * put the object, so on that second request the storage key is user input. The
 * only thing standing between a forged key and a page row pointing at somebody
 * else's image is `isStorageKeyOwnedBy`. That makes its false-accept cases
 * worth pinning down explicitly.
 */

const USER = asUserId("11111111-1111-1111-1111-111111111111");
const OTHER_USER = asUserId("99999999-9999-9999-9999-999999999999");
const BOOK = asBookId("22222222-2222-2222-2222-222222222222");
const OTHER_BOOK = asBookId("88888888-8888-8888-8888-888888888888");

const validKey = () => buildStorageKey(USER, BOOK, "image/jpeg");

describe("buildStorageKey", () => {
  it("produces a key its own ownership check accepts", () => {
    for (const contentType of ACCEPTED_CONTENT_TYPES) {
      const key = buildStorageKey(USER, BOOK, contentType);

      expect(isStorageKeyOwnedBy(key, USER, BOOK)).toBe(true);
    }
  });

  it("puts the owner first, so the prefix is the ownership claim", () => {
    expect(validKey().startsWith(`${USER}/${BOOK}/`)).toBe(true);
  });

  it("refuses a content type it has no extension for", () => {
    expect(() => buildStorageKey(USER, BOOK, "image/gif")).toThrow(
      /Unsupported content type/,
    );
  });

  it("does not derive the name from anything that can later change", () => {
    expect(validKey()).not.toBe(validKey());
  });
});

describe("isStorageKeyOwnedBy", () => {
  it("rejects another user's key", () => {
    const theirs = buildStorageKey(OTHER_USER, BOOK, "image/jpeg");

    expect(isStorageKeyOwnedBy(theirs, USER, BOOK)).toBe(false);
  });

  it("rejects this user's key under a different book", () => {
    const otherBook = buildStorageKey(USER, OTHER_BOOK, "image/jpeg");

    expect(isStorageKeyOwnedBy(otherBook, USER, BOOK)).toBe(false);
  });

  it("rejects a traversal segment that still starts with the prefix", () => {
    expect(
      isStorageKeyOwnedBy(
        `${USER}/${BOOK}/../../${OTHER_USER}/${OTHER_BOOK}/x.jpg`,
        USER,
        BOOK,
      ),
    ).toBe(false);
  });

  it("rejects a nested path under the right prefix", () => {
    expect(
      isStorageKeyOwnedBy(
        `${USER}/${BOOK}/nested/33333333-3333-3333-3333-333333333333.jpg`,
        USER,
        BOOK,
      ),
    ).toBe(false);
  });

  it("rejects a foreign key that merely contains the prefix", () => {
    expect(
      isStorageKeyOwnedBy(
        `${OTHER_USER}/${USER}/${BOOK}/33333333-3333-3333-3333-333333333333.jpg`,
        USER,
        BOOK,
      ),
    ).toBe(false);
  });

  it("requires a real dot before the extension", () => {
    // Regression: the pattern was built with `\.` inside a template literal,
    // which is not an escape and collapses to `.`, matching any character.
    expect(
      isStorageKeyOwnedBy(
        `${USER}/${BOOK}/33333333-3333-3333-3333-333333333333Xjpg`,
        USER,
        BOOK,
      ),
    ).toBe(false);
  });

  it("rejects an extension it never issues", () => {
    for (const bad of ["svg", "gif", "html", "jpg.html"]) {
      expect(
        isStorageKeyOwnedBy(
          `${USER}/${BOOK}/33333333-3333-3333-3333-333333333333.${bad}`,
          USER,
          BOOK,
        ),
      ).toBe(false);
    }
  });

  it("rejects the derived keys, which are never client-claimed", () => {
    // Only the raw upload key is ever asserted by a browser. Flattened images
    // are written server-side, so accepting one here would widen the surface
    // for no reason.
    const key = validKey();

    expect(isStorageKeyOwnedBy(flattenedKeyFor(key), USER, BOOK)).toBe(false);
    expect(isStorageKeyOwnedBy(revisedFlattenedKeyFor(key), USER, BOOK)).toBe(
      false,
    );
  });
});

describe("derived keys", () => {
  it("keep the owning prefix of the photograph they come from", () => {
    const key = validKey();
    const prefix = `${USER}/${BOOK}/`;

    expect(flattenedKeyFor(key).startsWith(prefix)).toBe(true);
    expect(revisedFlattenedKeyFor(key).startsWith(prefix)).toBe(true);
  });

  it("replaces the extension rather than appending to it", () => {
    expect(flattenedKeyFor("u/b/name.png")).toBe("u/b/name.flat.jpg");
  });

  it("gives each revision a distinct key so the old image stays readable", () => {
    const key = validKey();

    expect(revisedFlattenedKeyFor(key)).not.toBe(revisedFlattenedKeyFor(key));
  });
});

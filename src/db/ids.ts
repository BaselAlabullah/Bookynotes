/**
 * Branded identifier types.
 *
 * Every id in this app is a uuid, which means at the type level they are all
 * `string` and the compiler will happily let you pass a bookId where a userId
 * belongs. Given that user scoping is the app's only access control, that is
 * the single most expensive mistake available to us.
 *
 * A brand is a phantom property that exists only in the type system — it has no
 * runtime cost and produces no output. `UserId` is still just a string at
 * runtime; it simply cannot be swapped for a `PageId` by accident.
 *
 * Columns are tagged with these types in the schema via `.$type<...>()`, so the
 * branding flows outward through Drizzle's inferred row types automatically.
 */

// Declared but never defined: the symbol exists only to make each brand unique.
declare const brand: unique symbol;

type Branded<T, TBrand extends string> = T & { readonly [brand]: TBrand };

export type UserId = Branded<string, "UserId">;
export type BookId = Branded<string, "BookId">;
export type PageId = Branded<string, "PageId">;
export type AnnotationId = Branded<string, "AnnotationId">;

/**
 * The only sanctioned way into the branded types, used at the two places where
 * an untrusted string becomes a trusted id: the auth session (phase 3) and
 * request validation. Each is a checked cast, not a parse — validate the uuid
 * with Zod first, then brand it here.
 */
export const asUserId = (value: string): UserId => value as UserId;
export const asBookId = (value: string): BookId => value as BookId;
export const asPageId = (value: string): PageId => value as PageId;
export const asAnnotationId = (value: string): AnnotationId => value as AnnotationId;

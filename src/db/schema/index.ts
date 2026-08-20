/**
 * The complete data model in one import.
 *
 * Both drizzle-kit (for migrations) and the query client (for relational
 * queries) take the whole schema, so it is re-exported from here rather than
 * having either of them reach into individual files.
 *
 * Supabase's `auth.users` is deliberately absent: it is not ours to migrate.
 * The foreign keys pointing at it live in a hand-written migration.
 */
export { profiles } from "./profiles";
export { books } from "./books";
export { pages } from "./pages";
export { annotations, enrichmentStatus } from "./annotations";

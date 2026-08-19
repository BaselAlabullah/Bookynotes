import { signOutAction } from "../auth.actions";

/**
 * Sign out is a POST, not a link.
 *
 * A GET link would let any page on the internet sign the user out by embedding
 * an <img src="/sign-out">, and would let a prefetcher do it by accident. A form
 * post also means this needs no client-side JavaScript at all.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="text-sm text-ink-muted underline underline-offset-2"
      >
        Sign out
      </button>
    </form>
  );
}

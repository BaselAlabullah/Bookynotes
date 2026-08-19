/**
 * Error codes that `/auth/confirm` puts in the URL, and the words the user sees.
 *
 * Codes travel in the query string rather than the message itself: a message in
 * a URL is something an attacker can choose, and "your session expired, re-enter
 * your password here" is a convincing thing to be able to paint onto our own
 * sign-in page. An unrecognised code falls back to a generic sentence.
 */
const CONFIRMATION_ERRORS: Record<string, string> = {
  "invalid-confirmation-link":
    "That confirmation link is not valid. Request a new one by signing up again.",
  "confirmation-failed":
    "That confirmation link has expired or was already used. Try signing in, or sign up again.",
  "confirmation-wrong-browser":
    "Open the confirmation link in the same browser you signed up with, or sign in below.",
};

export function confirmationErrorMessage(
  code: string | undefined,
): string | null {
  if (!code) {
    return null;
  }

  return (
    CONFIRMATION_ERRORS[code] ??
    "Something went wrong confirming your email. Try signing in below."
  );
}

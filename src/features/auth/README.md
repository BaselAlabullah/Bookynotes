# features/auth

Sessions and identity. The boundary where a cookie becomes a trusted `UserId`.

```
supabase-server.ts        request-scoped Supabase client bound to Next's cookies
session-cookie.ts         the extra restrictions we put on the session cookie
auth.session.ts           getCurrentUser() and requireUser()
profiles.repository.ts    the username: create, look up, check availability
auth.schema.ts            zod validation for the credential forms
auth.actions.ts           signUp / signIn / signOut as Server Functions
components/               the credential form and the sign-out button
```

Four rules hold here:

1. **`getUser()`, never `getSession()`.** The cookie is attacker-supplied data.
   `getSession()` decodes and believes it; `getUser()` verifies it with
   Supabase's auth server.
2. **`requireUser()` is called next to the data access it protects**, not only
   in a layout. Next's own docs warn that Server Functions are POSTs to the
   route that rendered them, so route-level protection can silently lapse.
3. **This module is the only place a `UserId` is minted.** Everything that
   queries the database demands that branded type, so no query can run without
   having asked who the caller is.
4. **`src/proxy.ts` refreshes the session; it does not authorize.**

There is no Supabase browser client anywhere in the app, which is what lets the
session cookie be httpOnly. Read `session-cookie.ts` before adding one.

## Usernames

Supabase Auth owns the email and the password. The username is ours, in a
`profiles` table keyed by the Supabase user id.

It is deliberately not in `auth.users.raw_user_meta_data`, which would need no
table at all — that field is writable by the user through `updateUser`, and
nothing can put a unique constraint on it. Two people could hold the same name.
See DECISIONS 0062.

Uniqueness is a unique index on `lower(username)`, so "Basel" and "basel" cannot
both exist, while the capitalisation someone chose is preserved as typed.

Sign-up writes to two systems that cannot share a transaction: the account in
Supabase Auth, then the profile here. `isUsernameTaken` runs before either, so
the ordinary collision is a message beside the field rather than a half-made
account — but the unique index is the guarantee, and `signUpAction` handles
losing that race explicitly. See DECISIONS 0063.

Accounts created before profiles existed have no username and are shown by
email. `npm run username` lists them and sets one.

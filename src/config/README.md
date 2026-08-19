# config

Environment parsing and application constants.

`process.env` is read in exactly two files — `env.public.ts` and (from phase 2)
`env.server.ts` — and nowhere else. Everything downstream imports a validated,
fully typed object, so a missing variable is a startup error rather than an
`undefined` that surfaces three layers away.

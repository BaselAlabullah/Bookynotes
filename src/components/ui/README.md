# components/ui

Presentational primitives with no domain knowledge: buttons, fields, dialogs,
spinners.

A component here must not import from `features/`, `db/` or `integrations/`.
If it needs to know what a book is, it belongs in that feature's `components/`
folder instead.

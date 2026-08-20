import { Fragment } from "react";

import { HIGHLIGHT_END, HIGHLIGHT_START } from "../search.types";

/**
 * Renders a `ts_headline` snippet with its matches marked.
 *
 * Postgres wraps matches in two control characters, and this splits on them and
 * emits real `<mark>` elements. The alternative — asking Postgres for `<b>` and
 * rendering with `dangerouslySetInnerHTML` — would mean handing a user's own
 * note and a language model's output to an HTML parser. This does the same job
 * with no parser and no escape hatch.
 */
export function HighlightedSnippet({ text }: { text: string }) {
  // Split keeps the delimiters out, and because the markers always come in
  // pairs, every odd-indexed chunk is a match.
  const parts = text.split(new RegExp(`${HIGHLIGHT_START}|${HIGHLIGHT_END}`));

  return (
    <span>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={index}
            className="rounded-sm bg-accent/25 px-0.5 text-inherit"
          >
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </span>
  );
}

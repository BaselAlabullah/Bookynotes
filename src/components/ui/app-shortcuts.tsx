"use client";

import { useEffect, useState } from "react";

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function AppShortcuts() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isOpen) {
        setIsOpen(false);
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("#global-search")?.focus();
      } else if (event.key === "?") {
        event.preventDefault();
        setIsOpen((open) => !open);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex size-8 items-center justify-center border border-rule text-sm text-ink-muted hover:border-ink-muted hover:text-ink"
        aria-label="Keyboard shortcuts"
        aria-expanded={isOpen}
      >
        ?
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setIsOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            className="w-full max-w-sm border border-ink bg-paper-raised p-6 shadow-[0_18px_50px_rgba(0,0,0,0.14)]"
          >
            <div className="flex items-start justify-between gap-6 border-b border-rule pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-ink-muted">
                  Reference
                </p>
                <h2 id="shortcuts-title" className="mt-1 font-serif text-2xl">
                  Keyboard shortcuts
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-xl leading-none text-ink-muted hover:text-ink"
                aria-label="Close keyboard shortcuts"
              >
                ×
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 pt-4 text-sm">
              <dt><kbd>/</kbd></dt><dd>Focus search</dd>
              <dt><kbd>?</kbd></dt><dd>Show this reference</dd>
              <dt><kbd>← / →</kbd></dt><dd>Previous or next page</dd>
              <dt><kbd>j / k</kbd></dt><dd>Next or previous annotation</dd>
              <dt><kbd>Esc</kbd></dt><dd>Clear the selection</dd>
            </dl>
          </section>
        </div>
      ) : null}
    </>
  );
}

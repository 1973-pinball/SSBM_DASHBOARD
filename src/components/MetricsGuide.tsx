import { useEffect, useRef } from "react";
// Shared with scripts/render-seo-pages.mjs, which renders these same definitions
// as the static /metrics page. See that module for why it is plain .mjs.
import { SECTIONS } from "../../scripts/lib/metrics-data.mjs";

interface Props {
  onClose: () => void;
}

export function MetricsGuide({ onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // A text-selection drag that starts in the dialog and releases over the
  // backdrop dispatches its click on the overlay (the common ancestor), which
  // would close the modal mid-selection — only close when the press started
  // on the backdrop too.
  const pressedOnOverlay = useRef(false);

  // Focus the dialog on open, lock body scroll, and restore both on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Trap Tab inside the dialog so keyboard users can't reach the dashboard behind the overlay.
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      // Non-empty: the focusables.length === 0 case returned above.
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === dialog) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || active === dialog) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        pressedOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnOverlay.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Metrics guide"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Metrics guide</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <dl>
                {s.items.map((it) => (
                  <div key={it.term} className="metric-def">
                    <dt>{it.term}</dt>
                    <dd>{it.def}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="hint">
            Neutral and punish metrics come from slippi-js conversion detection over the replay's frame data; they exist only
            for games where that data is present.
          </p>
        </div>
      </div>
    </div>
  );
}

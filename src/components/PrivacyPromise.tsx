import { useEffect, useRef } from "react";

export function PrivacyPromise({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const pressedOnOverlay = useRef(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      if (!focusables?.length) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => { pressedOnOverlay.current = event.target === event.currentTarget; }}
      onClick={(event) => { if (pressedOnOverlay.current && event.target === event.currentTarget) onClose(); }}
    >
      <div className="modal privacy-modal" role="dialog" aria-modal="true" aria-label="Privacy promise" ref={dialogRef} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>Privacy promise</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <div className="privacy-promise-lead">Your replays are yours. Community research requires a separate yes.</div>
          <section>
            <h3>Raw replay files</h3>
            <p>Raw replay files (<span className="data">.slp</span> and <span className="data">.slpz</span>) never leave your device. Parsing and decompression happen in your browser, and frame data is discarded.</p>
          </section>
          <section>
            <h3>Private cloud sync</h3>
            <p>Google sign-in is optional. If you choose it, parsed statistics—not replay files—are mirrored to your private account so you can restore them on another device. Other signed-in users cannot read those rows.</p>
          </section>
          <section>
            <h3>Community contribution</h3>
            <p>Community contribution is separate from cloud sync, off by default, and reversible in My Account. Replay-derived data is never published or distributed beyond private sync without that explicit opt-in.</p>
            <p>Community aggregates use both players' stats from contributed games, counting each game once even when both players upload it. Public views contain only thresholded aggregates. They never publish connect codes, display names, replay paths, exact activity timelines, geographic inference, or downloadable row-level data.</p>
          </section>
          <section>
            <h3>Visit counting</h3>
            <p>The hosted site counts page views with Vercel Web Analytics: cookieless, no identifier, and limited to page views, referrers and country. It never touches replay data or anything derived from it, and it is the only exception to the no-telemetry rule above. A self-hosted build carries the mount inertly and transmits nothing.</p>
          </section>
          <section>
            <h3>Your email</h3>
            <p>Your email is used only by the authentication system to operate your sign-in. We never sell it, publish it, use it for marketing, or share it for outreach.</p>
          </section>
          <section>
            <h3>Your control</h3>
            <p>Turning Community contribution off excludes your private rows from the next aggregate refresh. Questions about this promise can be sent to <a href="mailto:info.studio.pinball@gmail.com">info.studio.pinball@gmail.com</a>.</p>
          </section>
          <section>
            <h3>Don't take our word for it</h3>
            <p>Everything above is a claim about what the code does, and the code is public: <a href="https://github.com/1973-pinball/SSBM_DASHBOARD">github.com/1973-pinball/SSBM_DASHBOARD</a>, MIT licensed.</p>
            <p>Be clear about what that settles. Reading the source tells you what the code does — not that this server is running exactly that code. These builds aren't reproducible, so nobody can diff what's served against what's published, and you should not accept "it's open source" as proof on its own.</p>
            <p>The check that needs no trust at all is your own browser. Open the network panel while a folder is parsing and watch: no request carries replay bytes. That is the promise at the top of this page, and you can verify it yourself, right now, without believing anything we say. Running your own build is the other route — a self-hosted copy with no cloud credentials configured has no sync and no community contribution at all.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

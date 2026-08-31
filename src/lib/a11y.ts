import type { KeyboardEvent } from "react";

/** Keyboard equivalent for click-to-filter rows and matrix cells. */
export function activateOnKey(event: KeyboardEvent<HTMLElement>, activate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

/**
 * Roving focus for ARIA tab lists. Tab enters the active tab; arrow keys move
 * and select, matching the platform convention used by installed apps.
 *
 * A tab marked aria-disabled is stepped over rather than landed on. Because
 * arrowing selects as well as focuses, stopping on one would move the focus
 * ring off the panel the user is still looking at and open nothing in its
 * place — the keyboard equivalent of a click that does nothing.
 */
export function moveTabFocus(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const list = event.currentTarget.closest('[role="tablist"]');
  if (!list) return;
  const tabs = Array.from(
    list.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled]):not([aria-disabled="true"])'),
  );
  if (!tabs.length) return;
  const current = tabs.indexOf(event.currentTarget);
  let next = current;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else if (event.key === "ArrowRight") next = (Math.max(0, current) + 1) % tabs.length;
  else next = (Math.max(0, current) - 1 + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]!.focus();
  tabs[next]!.click();
}

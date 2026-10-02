"use client";

import { useEffect, useRef, type RefObject } from "react";

/*
 * Overlays stack: the room over a side panel, the theater over the room,
 * Present's caption under all of them. Escape closes only the top layer,
 * Tab stays inside it, and closing it hands focus back to what opened it.
 */

const stack: number[] = [];
let seq = 0;

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.getClientRects().length > 0);
}

/**
 * Registers an overlay while `open` is true. Attach the returned ref to the
 * overlay's container and give the container `tabIndex={-1}`.
 * `trap: false` is for layers that only take Escape, like Present's caption.
 */
export function useLayer<T extends HTMLElement>(open: boolean, close: () => void, { trap = true }: { trap?: boolean } = {}): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    if (!open) return;
    const id = ++seq;
    stack.push(id);
    const isTop = () => stack[stack.length - 1] === id;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // A child with autoFocus may already hold focus inside; leave it there.
    const el = ref.current;
    if (trap && el && !el.contains(document.activeElement)) (focusables(el)[0] ?? el).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      // Every layer hears the key. Only the top one acts, so one Escape closes one layer.
      if (!isTop()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      const box = ref.current;
      if (!trap || e.key !== "Tab" || !box) return;
      const items = focusables(box);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!first || !last) {
        e.preventDefault();
        box.focus({ preventScroll: true });
      } else if (!box.contains(active) || (e.shiftKey ? active === first : active === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      const active = document.activeElement;
      const focusWasHere = !active || active === document.body || (ref.current?.contains(active) ?? false);
      if (trap && focusWasHere && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, trap]);

  return ref;
}

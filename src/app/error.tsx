"use client";

import { useEffect } from "react";

/**
 * If anything in the page throws, say so plainly and offer a clean start
 * instead of a blank screen. The night is a fold of actions, so starting over
 * loses nothing that can't be replayed from a session link.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-md">
        <p className="eyebrow">Something broke</p>
        <h1 className="mt-3 font-display text-4xl font-light leading-tight text-ink-hi">This screen hit an error.</h1>
        <p className="mt-3 text-ink-mid">Nothing was sent anywhere and no real system is connected. Start the night again.</p>
        <button
          type="button"
          onClick={() => {
            if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
            reset();
          }}
          className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brass px-5 text-xs font-semibold uppercase tracking-[0.1em] text-ground-0 hover:bg-brass-ink"
        >
          Start again
        </button>
      </div>
    </main>
  );
}

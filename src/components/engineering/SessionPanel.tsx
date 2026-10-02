"use client";

import clsx from "clsx";
import { Check, Download, Link2 } from "lucide-react";
import { useState } from "react";
import { encodeSession, evaluate } from "@/twin/runtime";
import { useTwin } from "../experience/TwinContext";
import { Button, Eyebrow, Panel } from "../ui/primitives";

function describe(a: { type: string } & Record<string, unknown>): string {
  const arg = (a.scenario ?? a.fault ?? a.key ?? a.item ?? a.via ?? (a.remember === undefined ? "" : a.remember ? "remember" : "just tonight")) as string;
  return arg ? `${a.type} ${arg}` : a.type;
}

/**
 * The session as data. The screen is a fold of this list through the
 * reducer: step back to any point and the whole product rebuilds itself
 * read-only; copy the link and someone else gets the identical night.
 */
export function SessionPanel() {
  const { session, state } = useTwin();
  const [copied, setCopied] = useState(false);
  const steps = session.log.map((a, i) => ({ i: i + 1, text: describe(a as never) })).filter((s, i, all) => !(s.text === "TICK" && all[i + 1]?.text === "TICK"));
  const at = session.cursor ?? session.log.length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(session.link());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const exportState = () => {
    const e = evaluate(state);
    const blob = new Blob([JSON.stringify({ actions: session.log, state, decisions: e.decisions }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `savy-night-${state.scenario}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Eyebrow>Session · {session.live ? "live" : `viewing step ${at} of ${session.log.length}`}</Eyebrow>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={copy} disabled={session.log.length === 0}>
            {copied ? <Check aria-hidden className="size-3.5" /> : <Link2 aria-hidden className="size-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button variant="secondary" size="sm" onClick={exportState} disabled={session.log.length === 0}>
            <Download aria-hidden className="size-3.5" />
            Export
          </Button>
        </div>
      </div>
      {session.log.length > 1 && (
        <input
          type="range"
          aria-label="Time travel through the session"
          className="scrub mt-4 w-full"
          min={1}
          max={session.log.length}
          value={at}
          onChange={(e) => session.travelTo(Number(e.target.value))}
        />
      )}
      <ol className="mt-3 max-h-56 space-y-0.5 overflow-y-auto font-mono text-[0.6875rem]">
        {steps.map((s) => (
          <li key={s.i}>
            <button
              type="button"
              onClick={() => session.travelTo(s.i)}
              className={clsx("w-full rounded px-2 py-1 text-left", s.i === at ? "bg-brass/10 text-brass-ink" : "text-ink-mid hover:bg-ground-2")}
            >
              {String(s.i).padStart(3, " ")} · {s.text}
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-3 break-all font-mono text-[0.625rem] text-ink-lo">#s={encodeSession(session.log)}</p>
      {!session.live && (
        <Button variant="primary" size="sm" className="mt-3" onClick={() => session.travelTo(null)}>
          Return to live
        </Button>
      )}
    </Panel>
  );
}

/** Shown across every mode while an earlier point of the session is on screen. */
export function TimeTravelBanner() {
  const { session } = useTwin();
  if (session.live) return null;
  return (
    <div role="status" className="border-b border-brass/40 bg-brass/10">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <p className="text-sm text-ink-hi">
          <span className="font-semibold text-brass-ink">
            Viewing step {session.cursor} of {session.log.length}.
          </span>{" "}
          The whole product is rebuilt from the first {session.cursor} actions. Read-only.
        </p>
        <Button variant="primary" size="sm" onClick={() => session.travelTo(null)}>
          Return to live
        </Button>
      </div>
    </div>
  );
}

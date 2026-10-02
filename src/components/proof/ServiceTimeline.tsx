"use client";

import clsx from "clsx";
import { SERVICES } from "@/shadow/history";
import { agreementOf, classify, situationsOf, wouldSurface } from "@/shadow/replay";
import type { Situation } from "@/shadow/types";
import { Eyebrow, Panel } from "../ui/primitives";
import { CLASS } from "./tones";

function Dot({ situation }: { situation: Situation }) {
  const c = classify(situation);
  const surfaced = wouldSurface(situation);
  const disagree = agreementOf(situation) === "disagree";
  return (
    <span
      aria-hidden
      className={clsx(
        "flex size-4 items-center justify-center rounded-full",
        disagree ? "ring-1 ring-conflict" : surfaced ? "ring-1 ring-brass" : "",
      )}
    >
      <span className={clsx("size-2 rounded-full", CLASS[c].dot)} />
    </span>
  );
}

interface ServiceTimelineProps {
  selected: number;
  onSelect: (service: number) => void;
}

/** Thirty services, oldest to newest. Each dot is one situation Savy would have noticed. */
export function ServiceTimeline({ selected, onSelect }: ServiceTimelineProps) {
  return (
    <Panel className="p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Eyebrow>Service timeline</Eyebrow>
          <p className="mt-1.5 text-sm text-ink-mid">Pick a service to replay it as it happened.</p>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-mid">
          <li className="flex items-center gap-2">
            <span className={clsx("size-2 rounded-full", CLASS.useful.dot)} /> Useful
          </li>
          <li className="flex items-center gap-2">
            <span className={clsx("size-2 rounded-full", CLASS.already_handled.dot)} /> Already handled
          </li>
          <li className="flex items-center gap-2">
            <span className={clsx("size-2 rounded-full", CLASS.noise.dot)} /> Noise
          </li>
          <li className="flex items-center gap-2">
            <span className="size-3 rounded-full ring-1 ring-brass" /> Would reach the owner
          </li>
          <li className="flex items-center gap-2">
            <span className="size-3 rounded-full ring-1 ring-conflict" /> Disagreement
          </li>
        </ul>
      </div>

      <div className="mt-5 overflow-x-auto pb-2">
        <ol className="grid min-w-[860px] grid-cols-[repeat(30,minmax(0,1fr))] gap-1">
          {SERVICES.map((day) => {
            const situations = situationsOf(day.index);
            const active = selected === day.index;
            const [weekday, , dayOfMonth] = day.label.split(" ");
            return (
              <li key={day.index}>
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={`${day.label}: ${situations.length} ${situations.length === 1 ? "situation" : "situations"}`}
                  onClick={() => onSelect(day.index)}
                  className={clsx(
                    "flex h-32 w-full flex-col items-center justify-between rounded-lg border px-0.5 py-2 transition-colors duration-150",
                    active ? "border-brass bg-brass/10" : "border-transparent hover:border-line hover:bg-ground-2",
                  )}
                >
                  <span className="flex flex-col-reverse items-center gap-1">
                    {situations.map((s) => (
                      <Dot key={s.id} situation={s} />
                    ))}
                  </span>
                  <span className="text-center leading-tight">
                    <span className={clsx("block text-[0.625rem] uppercase tracking-wide", active ? "text-brass-ink" : "text-ink-lo")}>
                      {weekday}
                    </span>
                    <span className={clsx("block font-mono text-xs", active ? "text-ink-hi" : "text-ink-mid")}>{dayOfMonth}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}

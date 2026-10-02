"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Lock, Pause, Play } from "lucide-react";
import { useMemo } from "react";
import { formatClock, type Minutes } from "@/domain/clock";
import { DUR, EASE } from "@/lib/motion";
import { REPLAY_WINDOW, SERVICES } from "@/shadow/history";
import { replayAt, serviceEvents, situationsOf, titleOf } from "@/shadow/replay";
import type { ReplayEvent } from "@/shadow/types";
import { BasisBadge } from "../ui/badges";
import { Button, Eyebrow, Panel } from "../ui/primitives";

function VisibleRow({ event, onOpen }: { event: ReplayEvent; onOpen: (situationId: string) => void }) {
  const savy = event.role === "detection";
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE.outQuart }}
      className={clsx("rounded-lg px-3 py-2.5", savy ? "border border-brass/40 bg-brass/[0.06]" : "arrived")}
    >
      <div className="flex items-center justify-between gap-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        <span className={savy ? "text-brass-ink" : "text-ink-mid"}>{savy ? "Savy would have noticed" : event.source}</span>
        <time className="font-mono font-normal tracking-normal text-ink-lo">{formatClock(event.availableAt)}</time>
      </div>
      <p className="mt-1 text-sm leading-snug text-ink-hi">{event.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!savy && <BasisBadge basis={event.basis} />}
        {event.occurredAt !== event.availableAt && (
          <span className="text-xs text-ink-lo">
            Happened {formatClock(event.occurredAt)}. Reached a system {formatClock(event.availableAt)}.
          </span>
        )}
        {savy && (
          <button
            type="button"
            onClick={() => onOpen(event.situationId)}
            className="text-xs font-semibold uppercase tracking-[0.1em] text-brass-ink underline-offset-4 hover:underline"
          >
            Open this situation
          </button>
        )}
      </div>
    </motion.li>
  );
}

interface ReplayPanelProps {
  service: number;
  clock: Minutes;
  playing: boolean;
  onClock: (clock: Minutes) => void;
  onTogglePlay: () => void;
  onOpenSituation: (id: string) => void;
}

/**
 * Replays one past service against a clock. The list on the left is exactly
 * what `replayAt` returns for that clock; the list on the right is what it
 * withholds. Scrub the clock and rows cross from right to left.
 */
export function ReplayPanel({ service, clock, playing, onClock, onTogglePlay, onOpenSituation }: ReplayPanelProps) {
  const day = SERVICES.find((d) => d.index === service);
  const events = useMemo(() => serviceEvents(service), [service]);
  const situations = useMemo(() => situationsOf(service), [service]);
  const { visible, hidden } = useMemo(() => replayAt(events, clock), [events, clock]);
  const newestFirst = useMemo(() => visible.slice().reverse(), [visible]);

  if (situations.length === 0) {
    return (
      <Panel className="p-5 sm:p-7">
        <Eyebrow>Replay · {day?.label}</Eyebrow>
        <p className="mt-3 text-[0.9375rem] text-ink-mid">
          Savy would have detected nothing in this service. A quiet night is a result too.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="overflow-hidden">
      <div className="grid gap-6 border-b border-line p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <Eyebrow>Replay · {day?.label}</Eyebrow>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-sm text-ink-mid">Replay clock</span>
            <span className="font-mono text-4xl font-light text-ink-hi">{formatClock(clock)}</span>
          </p>
          <p className="mt-2 text-sm text-ink-mid">
            Only evidence available by this timestamp is included. {hidden.length} later{" "}
            {hidden.length === 1 ? "record is" : "records are"} locked.
          </p>
        </div>
        <Button variant={playing ? "secondary" : "primary"} onClick={onTogglePlay}>
          {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
          {playing ? "Pause replay" : "Replay historical service"}
        </Button>

        <div className="lg:col-span-2">
          <label htmlFor="replay-clock" className="sr-only">
            Replay clock
          </label>
          <input
            id="replay-clock"
            type="range"
            className="scrub w-full"
            min={REPLAY_WINDOW.opens}
            max={REPLAY_WINDOW.closes}
            step={1}
            value={clock}
            aria-valuetext={formatClock(clock)}
            onChange={(e) => onClock(Number(e.target.value))}
          />
          <div className="mt-2 flex justify-between font-mono text-xs text-ink-lo">
            <span>{formatClock(REPLAY_WINDOW.opens)}</span>
            <span>{formatClock(REPLAY_WINDOW.closes)}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {situations.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onClock(s.detectedAt)}
                className="rounded-full border border-line px-3 py-1 text-xs text-ink-mid transition-colors hover:border-ink-lo hover:text-ink-hi"
              >
                <span className="font-mono text-ink-lo">{formatClock(s.detectedAt)}</span> · {titleOf(s)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-px bg-line md:grid-cols-2">
        <div className="bg-ground-1 p-5 sm:p-6">
          <Eyebrow>Visible to Savy at {formatClock(clock)}</Eyebrow>
          <ol aria-live="polite" className="mt-3 space-y-2">
            <AnimatePresence initial={false}>
              {newestFirst.map((e) => (
                <VisibleRow key={e.id} event={e} onOpen={onOpenSituation} />
              ))}
            </AnimatePresence>
            {visible.length === 0 && <li className="text-sm text-ink-lo">Nothing has arrived yet.</li>}
          </ol>
        </div>

        <div className="bg-ground-1 p-5 sm:p-6">
          <Eyebrow>Not yet arrived · Savy cannot use these</Eyebrow>
          <ol className="mt-3 space-y-2">
            {hidden.map((e) => (
              <li key={e.id} className="flex gap-3 rounded-lg border border-dashed border-line px-3 py-2.5 opacity-70">
                <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-lo" />
                <div className="min-w-0">
                  <p className="flex items-center justify-between gap-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-lo">
                    <span>{e.role === "detection" ? "Savy" : e.source}</span>
                    <time className="font-mono font-normal tracking-normal">arrives {formatClock(e.availableAt)}</time>
                  </p>
                  <p className="mt-1 text-sm leading-snug text-ink-lo">{e.text}</p>
                </div>
              </li>
            ))}
            {hidden.length === 0 && <li className="text-sm text-ink-lo">Everything from this service has arrived.</li>}
          </ol>
        </div>
      </div>
    </Panel>
  );
}

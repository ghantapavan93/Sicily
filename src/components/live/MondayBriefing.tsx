"use client";

import { CalendarClock } from "lucide-react";
import { useMemo } from "react";
import { mondayOf } from "@/twin/briefings";
import { useTwin } from "../experience/TwinContext";
import { Chip, Eyebrow, Panel } from "../ui/primitives";

function Block({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-lo">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((x) => (
          <li key={x} className="text-[0.9375rem] leading-snug text-ink-hi">
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What "can wait until Monday" turns into. When the night closes, Savy drafts
 * Monday's briefing: the night, the decisions on the record, the agenda that
 * waited, and what memory changed.
 */
export function MondayBriefing() {
  const { state } = useTwin();
  const b = useMemo(() => mondayOf(state), [state]);
  if (!b.ready) return null;

  return (
    <Panel className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <CalendarClock aria-hidden className="size-4 text-brass-ink" />
          <Eyebrow className="!text-brass-ink">{b.title} · drafted at close</Eyebrow>
        </span>
        <Chip tone="neutral">For Monday morning</Chip>
      </div>
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <Block title="The night" items={b.night} />
        <Block title="Decided on the night" items={b.decided.map((d) => `${d.id} · ${d.line}`)} />
        <div>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-lo">Waited for Monday</p>
          {b.agenda.length === 0 ? (
            <p className="mt-2 text-[0.9375rem] text-ink-mid">Nothing was set aside.</p>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {b.agenda.map((a) => (
                <li key={a.title}>
                  <p className="text-[0.9375rem] font-semibold text-ink-hi">{a.title}</p>
                  <p className="text-sm text-ink-mid">{a.why}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Block title="Memory" items={b.learned.length ? b.learned : ["Tonight hasn't been written to memory yet."]} />
      </div>
      <p className="mt-5 border-t border-line-soft pt-4 text-sm text-ink-mid">{b.cash}</p>
    </Panel>
  );
}

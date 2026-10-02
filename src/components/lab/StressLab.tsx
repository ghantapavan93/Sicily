"use client";

import clsx from "clsx";
import { Check, FlaskConical, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { COMBINATIONS, RUN_COUNT, runLab, summarizeLab, type LabRun } from "@/twin/lab";
import { FAULTS } from "@/twin/ledger";
import { SCENARIO_ORDER, SCENARIOS } from "@/twin/scenarios";
import { Button, Chip, Eyebrow, Panel } from "../ui/primitives";

const CHUNK = 6;

/**
 * Every night, under every combination of the six faults, through the real
 * reducer, in this browser. The same function runs in the test suite.
 */
export function StressLab() {
  const [runs, setRuns] = useState<LabRun[]>([]);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = () => {
    setRuns([]);
    setOpen(null);
    setRunning(true);
    let next = 0;
    const step = () => {
      if (cancelled.current) return;
      const batch: LabRun[] = [];
      for (let i = 0; i < CHUNK && next < RUN_COUNT; i++, next++) batch.push(runLab(next));
      setRuns((r) => [...r, ...batch]);
      if (next < RUN_COUNT) window.setTimeout(step, 0);
      else setRunning(false);
    };
    window.setTimeout(step, 30);
  };

  const summary = useMemo(() => summarizeLab(runs), [runs]);
  const detail = open === null ? null : runs.find((r) => r.id === open) ?? null;

  return (
    <div className="space-y-5">
      <Panel className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <Eyebrow>Stress lab</Eyebrow>
            <h2 className="mt-2 font-display text-3xl font-light leading-tight text-ink-hi">Break it {RUN_COUNT} ways.</h2>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-mid">
              Three nights. Six things that can go wrong. {COMBINATIONS} combinations each. Every run goes through the real reducer and is held to the same promises: approvals only where Savy stands behind them, a way forward whenever it holds back, no invented figures, a clean close, and a link that replays to the identical record.
            </p>
          </div>
          <Button variant="primary" onClick={run} disabled={running}>
            <FlaskConical aria-hidden className="size-4" />
            {running ? `Running ${runs.length} of ${RUN_COUNT}` : runs.length ? `Run all ${RUN_COUNT} again` : `Run all ${RUN_COUNT}`}
          </Button>
        </div>
        {runs.length > 0 && (
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line-soft pt-5 sm:grid-cols-5">
            {[
              ["Runs", summary.runs],
              ["Checks", summary.checks],
              ["Promises broken", summary.failed],
              ["Recommended", summary.recommends],
              ["Held back", summary.withholds],
            ].map(([label, value]) => (
              <div key={label}>
                <dd className={clsx("font-display text-3xl font-light", label === "Promises broken" ? (value === 0 ? "text-verified" : "text-conflict") : "text-ink-hi")}>{value}</dd>
                <dt className="mt-1 text-xs text-ink-lo">{label}</dt>
              </div>
            ))}
          </dl>
        )}
      </Panel>

      {runs.length > 0 && (
        <Panel className="overflow-x-auto p-6">
          <div className="min-w-[720px] space-y-4">
            {SCENARIO_ORDER.map((sid, row) => (
              <div key={sid}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-lo">{SCENARIOS[sid].title}</p>
                <div className="grid grid-cols-[repeat(32,minmax(0,1fr))] gap-1">
                  {Array.from({ length: COMBINATIONS }, (_, i) => {
                    const id = row * COMBINATIONS + i;
                    const r = runs.find((x) => x.id === id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-label={`Run ${id + 1}: ${SCENARIOS[sid].title}, ${r ? (r.faults.length ? r.faults.map((f) => FAULTS[f].label).join(", ") : "no faults") : "not run yet"}`}
                        onClick={() => setOpen(id)}
                        disabled={!r}
                        className={clsx(
                          "flex aspect-square items-center justify-center rounded-[5px] border transition-colors",
                          !r ? "border-line-soft bg-transparent" : !r.passed ? "border-conflict bg-conflict/30" : r.recommends > 0 ? "border-brass/50 bg-brass/20" : "border-unknown/40 bg-unknown/10",
                          open === id && "ring-2 ring-ink-hi",
                        )}
                      >
                        {r && (r.passed ? <Check aria-hidden className="size-2.5 text-ink-hi/70" /> : <X aria-hidden className="size-2.5 text-conflict" />)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="flex flex-wrap gap-4 text-xs text-ink-lo">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-[3px] border border-brass/50 bg-brass/20" /> Kept its promises and recommended
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-[3px] border border-unknown/40 bg-unknown/10" /> Kept its promises and held back everything
              </span>
            </p>
          </div>
        </Panel>
      )}

      {detail && (
        <Panel className="p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>
              Run {detail.id + 1} · {SCENARIOS[detail.scenario].title}
            </Eyebrow>
            {detail.faults.length === 0 ? <Chip tone="neutral">No faults</Chip> : detail.faults.map((f) => <Chip key={f} tone="brass">{FAULTS[f].label}</Chip>)}
          </div>
          <ul className="mt-4 divide-y divide-line-soft">
            {detail.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-3 py-2 text-sm">
                {c.ok ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-verified" /> : <X aria-hidden className="mt-0.5 size-4 shrink-0 text-conflict" />}
                <span className="text-ink-hi">
                  {c.name}
                  {c.detail && <span className="ml-2 text-ink-lo">{c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

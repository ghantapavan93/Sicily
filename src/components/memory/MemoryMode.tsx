"use client";

import clsx from "clsx";
import { AlertTriangle, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { VENUE } from "@/domain/venue";
import { MIN_EVIDENCE, OPERATING_DNA, type Memory } from "@/twin/memory";
import { memoriesFor } from "@/twin/recall";
import { useTwin } from "../experience/TwinContext";
import { MondayBriefing } from "../live/MondayBriefing";
import { Chip, Eyebrow, Panel } from "../ui/primitives";
import { SavyEdge } from "../ui/savy-moment";

/** The memory.recorded entries already shown lighting up. A night is learned once, so it lights once. */
const shownLearning = new Set<string>();

const STATUS: Record<Memory["status"], { label: string; tone: "brass" | "unknown" | "conflict" }> = {
  pattern: { label: "Pattern", tone: "brass" },
  candidate: { label: "Candidate", tone: "unknown" },
  needs_revalidation: { label: "May no longer hold", tone: "conflict" },
};

const ORIGIN: Record<Memory["origin"], string> = {
  outcomes: "Learned from outcomes",
  operator: "Taught by the owner",
  disagreement: "Learned from a disagreement",
};

function MemoryCard({ m, light, delay }: { m: Memory; light: string | null; delay: number }) {
  const [open, setOpen] = useState(false);
  const records = [...m.supporting.map((r) => ({ ...r, supports: true })), ...m.counter.map((r) => ({ ...r, supports: false }))];
  const s = STATUS[m.status];

  return (
    <Panel className={clsx("relative p-6", m.status === "candidate" && "border-dashed")}>
      {light && m.updatedTonight && <SavyEdge kind="learning" id={`${light}-${m.id}`} delay={delay} />}
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={s.tone} dashed={m.status === "candidate"}>
          {s.label}
        </Chip>
        <Chip tone="neutral">{ORIGIN[m.origin]}</Chip>
        {m.createdBy === "owner" && (
          <Chip tone="neutral">
            <UserRound aria-hidden className="size-3" /> Co-created
          </Chip>
        )}
        {m.updatedTonight && <Chip tone="verified">Updated tonight</Chip>}
      </div>
      <h3 className={clsx("mt-4 font-display text-[1.6rem] font-light leading-snug", m.status === "pattern" ? "text-ink-hi" : "text-ink-mid")}>{m.statement}</h3>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-y border-line-soft py-3">
        <div>
          <dt className="text-[0.625rem] uppercase tracking-[0.12em] text-ink-lo">Supporting nights</dt>
          <dd className="mt-1 font-mono text-lg text-ink-hi">{m.supporting.length}</dd>
        </div>
        <div>
          <dt className="text-[0.625rem] uppercase tracking-[0.12em] text-ink-lo">Counterexamples</dt>
          <dd className={clsx("mt-1 font-mono text-lg", m.counter.length ? "text-conflict" : "text-ink-hi")}>{m.counter.length}</dd>
        </div>
        <div>
          <dt className="text-[0.625rem] uppercase tracking-[0.12em] text-ink-lo">Last validated</dt>
          <dd className="mt-1 font-mono text-lg text-ink-hi">{m.lastValidated}</dd>
        </div>
      </dl>

      {m.status === "needs_revalidation" && (
        <p className="mt-4 flex gap-2 rounded-xl border border-conflict/40 bg-conflict/[0.06] px-3 py-2.5 text-sm text-ink-hi">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-conflict" />
          This pattern may no longer hold. {m.counter.length} recent nights contradict it, so Savy has stopped leaning on it until it is revalidated.
        </p>
      )}
      {m.status === "candidate" && (
        <p className="mt-4 text-sm text-ink-mid">
          A candidate, not a pattern: it needs {MIN_EVIDENCE} supporting nights. It has {m.supporting.length}.
        </p>
      )}

      <p className="mt-4 border-l-2 border-brass/60 pl-3 text-[0.9375rem] leading-relaxed text-ink-hi">{m.usage}</p>

      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-ink-lo hover:text-ink-hi">
        {open ? "Hide" : "Show"} the {records.length} nights behind it
      </button>
      {open && (
        <ul className="mt-3 divide-y divide-line-soft">
          {records.map((r, i) => (
            <li key={`${r.date}-${i}`} className="grid grid-cols-[5.5rem_1fr] gap-3 py-2 text-sm">
              <span className={clsx("font-mono text-xs leading-5", r.tonight ? "text-brass-ink" : "text-ink-lo")}>{r.date}</span>
              <span className={r.supports ? "text-ink-mid" : "text-conflict"}>
                {!r.supports && "Against: "}
                {r.note}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * MEMORY. Not personalisation: outcomes. Every memory is computed from
 * nights and what happened on them, can be co-created by the owner, decays
 * when recent nights contradict it, and links to every night it stands on.
 */
export function MemoryMode() {
  const { state, view } = useTwin();
  const memories = useMemo(() => memoriesFor(state), [state]);
  const recorded = [...state.audit].reverse().find((a) => a.type === "memory.recorded");
  const [light] = useState(() => {
    if (!recorded || shownLearning.has(recorded.id)) return null;
    shownLearning.add(recorded.id);
    return recorded.id;
  });
  const order: Memory["status"][] = ["pattern", "candidate", "needs_revalidation"];
  const sorted = [...memories].sort((a, b) => Number(b.updatedTonight) - Number(a.updatedTonight) || order.indexOf(a.status) - order.indexOf(b.status));
  const updated = sorted.filter((m) => m.updatedTonight).map((m) => m.id);

  return (
    <div className="mx-auto max-w-[1200px] space-y-8 px-4 py-8 sm:px-6">
      <header className="max-w-3xl">
        <Eyebrow>Decision memory</Eyebrow>
        <h1 className="mt-3 font-display text-[clamp(2rem,4.4vw,3.5rem)] font-light leading-[1.05] tracking-[-0.01em] text-ink-hi">
          What has Savy learned about {VENUE.name}?
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-mid">
          Nothing here is a guess about personality. Each memory is computed from past decisions and what happened after them. Some were taught
          by the owner. Some are fading because the restaurant changed. Fewer than {MIN_EVIDENCE} nights is not a pattern.
        </p>
        {state.phase !== "remembered" && (
          <p className="mt-3 text-sm text-ink-lo">Tonight isn&apos;t in memory yet. Close the night in Live and it will be.</p>
        )}
      </header>

      <MondayBriefing />

      <div className="grid gap-5 lg:grid-cols-2">
        {sorted.map((m) => (
          <MemoryCard key={m.id} m={m} light={light} delay={Math.max(0, updated.indexOf(m.id)) * 450} />
        ))}
      </div>

      <section aria-label="Operating DNA">
        <Eyebrow>Operating DNA</Eyebrow>
        <h2 className="mt-2 font-display text-3xl font-light text-ink-hi">What makes this restaurant itself.</h2>
        <p className="mt-2 max-w-2xl text-ink-mid">A structured fingerprint built from outcomes, not opinions. Every value is synthetic here and labelled with what it stands on.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {OPERATING_DNA.map((g) => (
            <Panel key={g.group} className="p-5">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-brass-ink">{g.group}</p>
              <dl className="mt-3 space-y-3">
                {g.traits.map((t) => (
                  <div key={t.id}>
                    <dt className="flex items-baseline justify-between gap-2 text-xs text-ink-lo">
                      {t.label}
                      <span className="font-mono">{t.basis}</span>
                    </dt>
                    <dd className="mt-0.5 text-[0.9375rem] text-ink-hi">{t.value}</dd>
                    <dd className="text-xs text-ink-mid">{t.detail}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ))}
        </div>
      </section>

      {view === "engineering" && (
        <pre className="overflow-x-auto rounded-2xl border border-line bg-ground-0 p-4 font-mono text-xs leading-relaxed text-ink-mid">
          {JSON.stringify(
            memories.map((m) => ({ id: m.id, status: m.status, supporting: m.supporting.length, counter: m.counter.length, last_validated: m.lastValidated, created_by: m.createdBy })),
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}

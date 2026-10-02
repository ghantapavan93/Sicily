"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Check, FastForward, Lock, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatClock } from "@/domain/clock";
import { SOURCES } from "@/twin/sources";
import type { Autonomy, Decision } from "@/twin/types";
import { useTwin } from "../experience/TwinContext";
import { useLayer } from "../ui/layer";
import { BasisBadge, ConfidenceMeter, FreshnessBadge, OriginIcon } from "../ui/badges";
import { Button, Chip, Eyebrow } from "../ui/primitives";
import { SavyEdge } from "../ui/savy-moment";
import { FloorPlan } from "../floor/FloorPlan";
import { peakFloorOf } from "../floor/PeakFloor";
import { DecisionActions, StatusChip } from "./DecisionActions";
import { Receipt } from "./Receipt";

const LADDER: { id: Autonomy; label: string; says: string }[] = [
  { id: "observe", label: "Observe", says: "Savy notices and names it." },
  { id: "recommend", label: "Recommend", says: "Savy proposes. A person decides." },
  { id: "prepare", label: "Prepare", says: "Savy drafts the change. A person sends it." },
  { id: "execute", label: "Execute within policy", says: "Future exploration. Not in this prototype." },
];

type Audience = "owner" | "gm" | "engineering";

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line-soft px-6 py-5">
      <h3 className="flex items-baseline gap-3 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-lo">
        <span className="font-mono text-ink-lo/70">{String(n).padStart(2, "0")}</span>
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Evidence({ d }: { d: Decision }) {
  const { ev } = useTwin();
  const [open, setOpen] = useState<string | null>(null);
  const event = open ? ev.processed.find((e) => e.id === open) : null;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {d.evidence.map((e) => (
          <button
            key={e.eventId + e.label}
            type="button"
            aria-expanded={open === e.eventId}
            onClick={() => setOpen(open === e.eventId ? null : e.eventId)}
            className={clsx(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-left text-xs transition-colors",
              open === e.eventId ? "border-brass/60 bg-brass/10" : "border-line bg-ground-2 hover:border-ink-lo",
            )}
          >
            <OriginIcon origin={e.source} className="size-3.5 text-ink-lo" />
            <span className="text-ink-mid">{e.label}</span>
            <span className="font-mono text-ink-hi">{e.value}</span>
          </button>
        ))}
      </div>
      <AnimatePresence>
        {event && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3 rounded-xl border border-line bg-ground-0 p-3 font-mono text-[0.6875rem] leading-relaxed text-ink-mid">
              <p className="text-ink-hi">{event.summary}</p>
              <p>
                {event.id} · {event.kind} · {SOURCES[event.source].label}
              </p>
              <p>
                arrived {formatClock(event.availableAt)} · dedupe {event.dedupeKey}
              </p>
              <div className="mt-2 flex gap-1.5 font-sans">
                {d.evidence
                  .filter((x) => x.eventId === event.id)
                  .map((x) => (
                    <span key={x.label} className="flex gap-1.5">
                      <BasisBadge basis={x.basis} />
                      <FreshnessBadge freshness={x.freshness} />
                    </span>
                  ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The dining room at the peak, as decided so far: where the averages above actually land. */
function RoomFloor() {
  const { ev } = useTwin();
  const floor = peakFloorOf(ev);
  if (!floor) return null;
  return (
    <div className="mt-4 rounded-2xl border border-line bg-ground-0/60 p-3">
      <FloorPlan floor={floor} title="The floor at the peak" />
    </div>
  );
}

/**
 * The Decision Room. One decision, everything about it, in the order an
 * owner asks: what changed, why it matters, what Savy recommends, what it
 * doesn't know, what would change its mind, who can decide, and what
 * happens if nobody does.
 */
export function DecisionRoom() {
  const { room, openRoom, ev, state, dispatch, setTheater, moment, session } = useTwin();
  const d = room ? ev.decisions.find((x) => x.key === room) ?? null : null;
  const [audience, setAudience] = useState<Audience>("owner");
  const receipt = d ? [...state.receipts].reverse().find((r) => r.decision === d.key) : undefined;
  const versions = d ? state.versions[d.key] ?? [] : [];
  const teaching = d && state.pendingTeach?.key === d.key;

  const layer = useLayer<HTMLElement>(d !== null, () => openRoom(null));

  return (
    <AnimatePresence>
      {d && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-[56] bg-ground-0/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => openRoom(null)}
          />
          <motion.aside
            key="room"
            ref={layer}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={`Decision room: ${d.title}`}
            className="fixed inset-y-0 right-0 z-[57] flex w-full max-w-[46rem] flex-col outline-none border-l border-line bg-ground-1 shadow-[-30px_0_80px_-40px_rgba(0,0,0,0.95)]"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 260, damping: 32 }}
          >
            <header className="relative border-b border-line px-6 pb-5 pt-5">
              {moment?.kind === "transition" && moment.keys.includes(d.key) && <SavyEdge kind="transition" id={moment.id} />}
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Eyebrow>Decision room</Eyebrow>
                  <span className="font-mono text-xs text-ink-lo">
                    {d.id} · v{Math.max(1, versions.length)}
                  </span>
                  <StatusChip status={d.status} lane={d.lane} />
                </div>
                <button type="button" aria-label="Close the decision room" onClick={() => openRoom(null)} className="flex size-8 items-center justify-center rounded-full text-ink-lo hover:bg-ground-3 hover:text-ink-hi">
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              <h2 className="mt-3 font-display text-[1.9rem] font-light leading-[1.1] text-ink-hi">{d.title}</h2>
              <AnimatePresence mode="wait" initial={false}>
                <motion.p key={audience} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-2 text-[0.9375rem] leading-relaxed text-ink-mid">
                  {audience === "engineering" ? (
                    <span className="block space-y-1 font-mono text-xs">
                      {d.explain.engineering.map((l) => (
                        <span key={l} className="block">
                          {l}
                        </span>
                      ))}
                    </span>
                  ) : (
                    d.explain[audience]
                  )}
                </motion.p>
              </AnimatePresence>
              <div role="group" aria-label="Explain it for" className="mt-4 flex w-fit rounded-full border border-line bg-ground-0 p-0.5">
                {(
                  [
                    ["owner", "Owner"],
                    ["gm", "On the floor"],
                    ["engineering", "Engineering"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={audience === id}
                    onClick={() => setAudience(id)}
                    className={clsx("rounded-full px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.1em]", audience === id ? "bg-ground-3 text-ink-hi" : "text-ink-lo hover:text-ink-mid")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {teaching && (
                <div className="mx-6 mt-5 rounded-2xl border border-brass/45 bg-brass/[0.06] p-4">
                  <p className="text-sm font-semibold text-ink-hi">
                    {state.pendingTeach?.reason === "manager_overruled" ? "The manager overruled this." : "You set this aside."} Is it a one-off, or something Savy should remember?
                  </p>
                  <p className="mt-1 text-xs text-ink-mid">A remembered pattern stays a candidate until more nights agree with it.</p>
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => dispatch({ type: "TEACH", remember: false })}>
                      Just tonight
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => dispatch({ type: "TEACH", remember: true })}>
                      Remember this pattern
                    </Button>
                  </div>
                </div>
              )}

              <Section n={1} title="What changed">
                <ul className="space-y-1.5">
                  {d.whatChanged.map((w) => (
                    <li key={w} className="flex gap-2.5 text-[0.9375rem] leading-relaxed text-ink-hi">
                      <span aria-hidden className="mt-[0.6rem] size-1 shrink-0 rounded-full bg-brass/70" />
                      {w}
                    </li>
                  ))}
                </ul>
              </Section>

              <Section n={2} title="Why it matters">
                <p className="text-[0.9375rem] leading-relaxed text-ink-hi">{d.whyItMatters}</p>
                {d.domain === "labor" && <RoomFloor />}
              </Section>

              <Section n={3} title={d.recommendation?.approvable ? "What Savy recommends" : "What happens next"}>
                {d.recommendation ? (
                  <div className={clsx("rounded-2xl border p-4", d.recommendation.approvable ? "border-brass/50 bg-brass/[0.05]" : "border-dashed border-unknown/60")}>
                    <p className="text-lg font-semibold leading-snug text-ink-hi">{d.recommendation.action}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-mid">{d.recommendation.detail}</p>
                    {d.effects.length > 0 && (
                      <dl className="mt-3 divide-y divide-line-soft border-t border-line-soft">
                        {d.effects.map((e) => (
                          <div key={e.label} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                            <dt className="text-sm text-ink-mid">{e.label}</dt>
                            <dd className="flex items-center gap-2 font-mono text-sm">
                              <span className="text-ink-lo">{e.from}</span>→<span className="font-semibold text-ink-hi">{e.to}</span>
                              <BasisBadge basis={e.basis} />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                ) : (
                  <p className="text-[0.9375rem] text-ink-mid">No recommendation. {d.headline}</p>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <ConfidenceMeter level={d.confidence.level} />
                  <span className="text-xs text-ink-lo">{d.confidence.reasons.join(" ")}</span>
                </div>
              </Section>

              <Section n={4} title="What Savy still doesn't know">
                {d.stillUnknown.length ? (
                  <ul className="space-y-1.5">
                    {d.stillUnknown.map((u) => (
                      <li key={u} className="text-[0.9375rem] leading-relaxed text-ink-mid">
                        {u}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[0.9375rem] text-ink-mid">Nothing this decision depends on.</p>
                )}
              </Section>

              <Section n={5} title="What would change Savy's mind">
                <ul className="space-y-1.5">
                  {d.wouldChangeMind.map((w) => (
                    <li key={w} className="text-[0.9375rem] leading-relaxed text-ink-mid">
                      {w}
                    </li>
                  ))}
                </ul>
              </Section>

              <Section n={6} title="Who has authority">
                <p className="text-[0.9375rem] text-ink-hi">
                  <span className="font-semibold">{d.authority.role}.</span> <span className="text-ink-mid">{d.authority.why}</span>
                </p>
                <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Autonomy ladder">
                  {LADDER.map((step) => {
                    const here = step.id === d.autonomy;
                    const future = step.id === "execute";
                    return (
                      <li
                        key={step.id}
                        className={clsx(
                          "rounded-xl border px-2.5 py-2",
                          here ? "border-brass/60 bg-brass/10" : future ? "border-dashed border-line" : "border-line bg-ground-2/40",
                        )}
                      >
                        <p className={clsx("flex items-center gap-1 text-[0.625rem] font-semibold uppercase tracking-[0.1em]", here ? "text-brass-ink" : "text-ink-lo")}>
                          {future && <Lock aria-hidden className="size-3" />}
                          {step.label}
                        </p>
                        <p className="mt-1 text-[0.6875rem] leading-snug text-ink-lo">{step.says}</p>
                      </li>
                    );
                  })}
                </ol>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-verified">Savy can</p>
                    <ul className="mt-2 space-y-1">
                      {d.permissions.can.map((p) => (
                        <li key={p} className="flex gap-2 text-sm text-ink-mid">
                          <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-verified" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-ink-lo">Savy cannot</p>
                    <ul className="mt-2 space-y-1">
                      {d.permissions.cannot.map((p) => (
                        <li key={p} className="flex gap-2 text-sm text-ink-mid">
                          <X aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-lo" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-ground-0 p-3 font-mono text-[0.6875rem] leading-relaxed text-ink-mid">
                  {`requires_owner_approval = ${d.guard.requiresApproval}\nevidence_sufficient     = ${d.guard.evidenceSufficient}\nexternal_action_allowed = false${d.guard.rules.length ? `\n${d.guard.rules.map((r) => `# ${r}`).join("\n")}` : ""}`}
                </pre>
              </Section>

              <Section n={7} title="What happens if we do nothing">
                <p className="text-[0.9375rem] leading-relaxed text-ink-hi">{d.doNothing}</p>
                {(d.domain === "labor" || d.domain === "inventory" || d.domain === "supply") && ev.twin.demand.peakCovers !== null && (
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => setTheater("nothing")}>
                    <FastForward aria-hidden className="size-3.5" />
                    Run the night both ways
                  </Button>
                )}
              </Section>

              <Section n={8} title="The evidence">
                <Evidence d={d} />
              </Section>

              <Section n={9} title="This decision's ledger">
                <ol className="space-y-2">
                  {versions.map((v) => (
                    <li key={v.version} className="grid grid-cols-[2.5rem_4.5rem_1fr] gap-2 text-sm">
                      <span className="font-mono text-brass-ink">v{v.version}</span>
                      <span className="font-mono text-xs leading-5 text-ink-lo">{formatClock(v.at)}</span>
                      <span className="text-ink-mid">
                        <span className="text-ink-hi">{v.summary}</span>
                        <span className="block font-mono text-[0.6875rem] text-ink-lo">
                          {v.status} · after {v.cause}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Section>

              {receipt && (
                <div className="px-6 pb-6">
                  <Receipt receipt={receipt} />
                </div>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-ground-0/80 px-6 py-4">
              {session.live ? <DecisionActions decision={d} /> : <Chip tone="brass">Viewing the past · read-only</Chip>}
              <span className="text-xs text-ink-lo">{d.urgency.label}</span>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useState, type ReactNode } from "react";
import { formatAge, formatClock } from "@/domain/clock";
import { plural, usd } from "@/twin/format";
import { ENGINES } from "@/twin/pulse";
import { memoriesFor } from "@/twin/recall";
import { SOURCE_ORDER, SOURCES } from "@/twin/sources";
import type { SpecialistId } from "@/twin/types";
import { useTwin } from "../experience/TwinContext";
import { OriginIcon } from "../ui/badges";
import { EngineIcon } from "../ui/engine-icon";
import { Chip, Eyebrow, Panel } from "../ui/primitives";
import { SessionPanel } from "./SessionPanel";

type NodeId = "sources" | "ledger" | "normalize" | "state" | "savy" | "decisions" | "approval" | "action" | "outcome" | "memory";

const NODES: { id: NodeId; label: string; what: string }[] = [
  { id: "sources", label: "Connected systems", what: "POS, reservations, time and payroll, staff app, inventory, supplier email, bank, listings" },
  { id: "ledger", label: "Event ledger", what: "Every event, in arrival order, with availableAt and a dedupe key" },
  { id: "normalize", label: "Normalize + dedupe", what: "Duplicates set aside, staleness marked, disagreements surfaced" },
  { id: "state", label: "Restaurant state", what: "The twin: demand, floor, stock, orders, invoices, cash" },
  { id: "savy", label: "Savy", what: "Six engines, six specialists, one decision model" },
  { id: "decisions", label: "Decision ledger", what: "Each decision versioned v1 → vN, with the event that moved it" },
  { id: "approval", label: "Human approval", what: "The guard: authority, evidence, external_action_allowed = false" },
  { id: "action", label: "Action", what: "What people did, and what vendors answered" },
  { id: "outcome", label: "Outcome", what: "Expected against what happened at close" },
  { id: "memory", label: "Memory", what: "Outcomes compiled into patterns that can decay" },
];

const SPECIALIST_LABEL: Record<SpecialistId, string> = { demand: "Demand", labor: "Labor", supply: "Supply", finance: "Finance", risk: "Risk", memory: "Memory" };

function Code({ children }: { children: ReactNode }) {
  return <pre className="overflow-x-auto rounded-xl border border-line bg-ground-0 p-3 font-mono text-[0.6875rem] leading-relaxed text-ink-mid">{children}</pre>;
}

function Inspector({ node }: { node: NodeId }) {
  const { state, ev, trace } = useTwin();
  const t = ev.twin;
  const dups = new Set(t.ledger.duplicates.map((d) => d.ignored));

  switch (node) {
    case "sources":
      return (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line-soft">
            {t.health.map((h) => (
              <tr key={h.source}>
                <td className="py-2">
                  <span className="flex items-center gap-2 text-ink-hi">
                    <OriginIcon origin={h.source} className="text-ink-lo" />
                    {SOURCES[h.source].label}
                  </span>
                  <span className="block text-xs text-ink-lo">{SOURCES[h.source].system}</span>
                </td>
                <td className="py-2 font-mono text-xs text-ink-lo">{h.last === null ? "—" : formatClock(h.last)}</td>
                <td className="py-2 font-mono text-xs text-ink-lo">{formatAge(h.ageMin)}</td>
                <td className="py-2 text-right">
                  <Chip tone={h.freshness === "fresh" ? "verified" : h.freshness === "stale" ? "brass" : "unknown"}>{h.freshness}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "ledger":
      return (
        <div className="max-h-[32rem] overflow-y-auto">
          <table className="w-full font-mono text-[0.6875rem]">
            <thead className="sticky top-0 bg-ground-1 text-left text-ink-lo">
              <tr>
                <th className="py-1.5 pr-2 font-normal">id</th>
                <th className="py-1.5 pr-2 font-normal">at</th>
                <th className="py-1.5 pr-2 font-normal">kind</th>
                <th className="py-1.5 font-normal">state</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {[...ev.timeline, ...state.caused]
                .filter((e) => e.availableAt <= state.clock)
                .map((e) => (
                  <tr key={e.id} className={clsx(e.routine && "opacity-50")}>
                    <td className="py-1.5 pr-2 text-ink-hi">{e.id}</td>
                    <td className="py-1.5 pr-2 text-ink-lo">{formatClock(e.availableAt)}</td>
                    <td className="py-1.5 pr-2 text-ink-mid">{e.kind}</td>
                    <td className={clsx("py-1.5", dups.has(e.id) ? "text-ink-lo" : e.availableAt > state.processedThrough ? "text-brass-ink" : "text-verified")}>
                      {dups.has(e.id) ? "duplicate" : e.availableAt > state.processedThrough ? "unread" : e.routine ? "routine" : "processed"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      );
    case "normalize":
      return (
        <Code>
          {JSON.stringify(
            {
              verified: t.ledger.verified.map((v) => `${v.claim} ← ${v.eventId}`),
              duplicates: t.ledger.duplicates,
              stale: t.ledger.stale,
              conflicts: t.ledger.conflicts.map((c) => ({ claim: c.claim, a: `${c.a.value} (${c.a.eventId})`, b: `${c.b.value} (${c.b.eventId})`, resolvedBy: c.resolvedBy })),
              missing: t.ledger.missing,
              unverified: t.ledger.unverified,
            },
            null,
            2,
          )}
        </Code>
      );
    case "state":
      return (
        <Code>
          {JSON.stringify(
            {
              as_of: formatClock(t.clock),
              demand: { booked: t.demand.booked?.value ?? null, disputed: t.demand.disputed?.value ?? null, peak_hour_covers: t.demand.peakCovers, vs_plan_pct: t.demand.vsPlanPct === null ? null : Math.round(t.demand.vsPlanPct) },
              staffing: { servers: t.staffing.servers, called_out: t.staffing.calledOut.map((s) => s.name), added: t.staffing.added.map((s) => s.name), peak_load: t.staffing.peakLoad, ceiling: t.staffing.ceiling },
              labor: { wages: t.labor.wages, projected_sales: t.labor.projectedSales === null ? null : Math.round(t.labor.projectedSales), pct: t.labor.pct === null ? null : Number(t.labor.pct.toFixed(1)) },
              inventory: t.inventory.map((i) => ({ item: i.item, line: i.line?.value ?? null, backup: i.backup?.value ?? null, forecast: i.forecast, exposure: i.exposure, status: i.status })),
              purchasing: { status: t.purchasing.status, lines: t.purchasing.lines.map((l) => `${l.item} ${l.qty}`), total: t.purchasing.total },
              invoices: t.invoices.map((i) => ({ number: i.number, verdict: i.verdict, price_effect: i.priceEffect, duplicates_suppressed: i.duplicatesSuppressed })),
              cash: { projected: t.cash.projected, proposed_delta: t.cash.proposedDelta, floor: t.cash.floor },
            },
            null,
            2,
          )}
        </Code>
      );
    case "savy":
      return (
        <div className="space-y-5">
          <ul className="grid gap-2 sm:grid-cols-2">
            {ENGINES.map((e) => (
              <li key={e.id} className="rounded-xl border border-line p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink-hi">
                  <EngineIcon engine={e.id} className="text-brass-ink" />
                  {e.label}
                </p>
                <p className="mt-1 text-xs leading-snug text-ink-lo">{e.does}</p>
                {trace?.lines[e.id][0] && <p className="mt-1.5 font-mono text-[0.625rem] leading-snug text-ink-mid">last: {trace.lines[e.id][0]}</p>}
              </li>
            ))}
          </ul>
          <div>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-lo">Specialists say</p>
            <p className="mt-1 text-xs text-ink-lo">Not chatbots. Each returns typed observations; the decision engine combines them.</p>
            <dl className="mt-3 space-y-3">
              {(Object.keys(SPECIALIST_LABEL) as SpecialistId[]).map((s) => {
                const obs = ev.observations.filter((o) => o.specialist === s);
                if (!obs.length) return null;
                return (
                  <div key={s}>
                    <dt className="text-xs font-semibold text-brass-ink">{SPECIALIST_LABEL[s]}</dt>
                    {obs.map((o) => (
                      <dd key={o.text} className={clsx("mt-0.5 text-sm", o.counted ? "text-ink-hi" : "text-ink-lo")}>
                        {o.text}
                        {!o.counted && <span className="ml-1.5 text-[0.625rem] uppercase tracking-[0.1em]">not counted</span>}
                      </dd>
                    ))}
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      );
    case "decisions":
      return (
        <ul className="space-y-4">
          {ev.decisions.map((d) => (
            <li key={d.key}>
              <p className="flex items-center gap-2 text-sm text-ink-hi">
                <span className="font-mono text-brass-ink">{d.id}</span>
                {d.title}
              </p>
              <ol className="mt-1.5 space-y-1 border-l border-line pl-3">
                {(state.versions[d.key] ?? []).map((v) => (
                  <li key={v.version} className="font-mono text-[0.6875rem] text-ink-mid">
                    v{v.version} · {formatClock(v.at)} · {v.status} · {v.summary} <span className="text-ink-lo">← {v.cause}</span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      );
    case "approval":
      return (
        <div className="space-y-3">
          {ev.decisions.map((d) => (
            <Code key={d.key}>
              {`${d.id} (${d.status})\n  authority               = ${d.authority.role}\n  autonomy                = ${d.autonomy}\n  requires_owner_approval = ${d.guard.requiresApproval}\n  evidence_sufficient     = ${d.guard.evidenceSufficient}\n  external_action_allowed = false`}
            </Code>
          ))}
          {state.receipts.length > 0 && <p className="text-xs text-ink-lo">Receipts: {state.receipts.map((r) => r.id).join(", ")}</p>}
        </div>
      );
    case "action":
      return (
        <div className="space-y-3">
          <ol className="space-y-1.5">
            {state.audit
              .filter((a) => a.actor !== "savy")
              .slice(-16)
              .map((a) => (
                <li key={a.id} className="font-mono text-[0.6875rem] text-ink-mid">
                  {formatClock(a.at)} · <span className="text-ink-hi">{a.actor}</span> · {a.type} · {a.label}
                </li>
              ))}
          </ol>
          {state.submission && <Code>{state.submission.log.map((l) => `${formatClock(l.at)}  ${l.text}`).join("\n")}</Code>}
        </div>
      );
    case "outcome":
      return state.outcome ? (
        <Code>
          {JSON.stringify(
            {
              closed_at: formatClock(state.outcome.closedAt),
              expected: state.outcome.expected,
              actual: { ...state.outcome.actual.totals, sales: usd(state.outcome.actual.totals.sales), actions: state.outcome.actual.actions },
              lessons: state.outcome.lessons,
            },
            null,
            2,
          )}
        </Code>
      ) : (
        <p className="text-sm text-ink-mid">The night hasn&apos;t closed. Outcomes are recorded at close, never predicted into memory.</p>
      );
    case "memory":
      return (
        <ul className="divide-y divide-line-soft">
          {memoriesFor(state).map((m) => (
            <li key={m.id} className="py-2 text-sm">
              <span className="font-mono text-xs text-brass-ink">{m.id}</span>
              <span className="ml-2 text-ink-mid">
                {m.status} · {m.supporting.length}+ / {m.counter.length}− · {m.lastValidated}
                {m.updatedTonight && " · updated tonight"}
              </span>
            </li>
          ))}
        </ul>
      );
  }
}

/**
 * ENGINEERING VIEW. The same night, shown as the runtime that produced it:
 * events → ledger → state → Savy → decisions → people → outcome → memory.
 * Every block opens onto the live data behind it. Nothing here is a mock-up
 * of the system; it is the system's own state.
 */
export function EngineeringRoom() {
  const { state, ev } = useTwin();
  const [node, setNode] = useState<NodeId>("savy");
  const live = state.phase === "processing" || state.phase === "arriving";
  const stat: Record<NodeId, string> = {
    sources: `${SOURCE_ORDER.length} systems · ${ev.twin.health.filter((h) => h.freshness === "stale").length} stale`,
    ledger: plural(ev.arrived.length, "event"),
    normalize: `${plural(ev.twin.ledger.duplicates.length, "duplicate")} · ${plural(ev.twin.ledger.conflicts.length, "conflict")}`,
    state: `as of ${formatClock(ev.twin.clock)}`,
    savy: plural(ev.observations.length, "observation"),
    decisions: `${plural(ev.decisions.length, "decision")} · ${plural(Object.values(state.versions).reduce((n, v) => n + v.length, 0), "version")}`,
    approval: `${ev.decisions.filter((d) => d.guard.requiresApproval).length} gated · 0 external`,
    action: plural(state.audit.filter((a) => a.actor === "owner" || a.actor === "manager" || a.actor === "vendor").length, "action"),
    outcome: state.outcome ? "recorded" : "pending",
    memory: state.phase === "remembered" ? "updated tonight" : "waiting",
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8 sm:px-6">
      <header className="max-w-3xl">
        <Eyebrow>Engineering view</Eyebrow>
        <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3.25rem)] font-light leading-[1.05] text-ink-hi">The UI is a projection of an event-driven restaurant model.</h1>
        <p className="mt-3 text-lg text-ink-mid">Click any block. What opens is the live data behind tonight, not a diagram of it.</p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <ol className="space-y-0" aria-label="System map">
          {NODES.map((n, i) => (
            <Fragment key={n.id}>
              <li>
                <button
                  type="button"
                  aria-pressed={node === n.id}
                  onClick={() => setNode(n.id)}
                  className={clsx(
                    "w-full rounded-2xl border px-4 py-3 text-left transition-colors",
                    node === n.id ? "border-brass/60 bg-brass/[0.07]" : "border-line bg-ground-1 hover:border-ink-lo",
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-ink-hi">{n.label}</span>
                    <span className="font-mono text-[0.625rem] text-ink-lo">{stat[n.id]}</span>
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-ink-lo">{n.what}</span>
                  {n.id === "savy" && (
                    <span className="mt-2.5 grid grid-cols-3 gap-1.5">
                      {ENGINES.map((e) => (
                        <span key={e.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[0.625rem] uppercase tracking-[0.08em] text-ink-mid">
                          <EngineIcon engine={e.id} className="size-3 text-brass-ink" />
                          {e.label}
                        </span>
                      ))}
                    </span>
                  )}
                  {n.id === "sources" && (
                    <span className="mt-2 flex gap-2">
                      {SOURCE_ORDER.map((s) => (
                        <OriginIcon key={s} origin={s} className="size-3.5 text-ink-lo" />
                      ))}
                    </span>
                  )}
                </button>
              </li>
              {i < NODES.length - 1 && (
                <li aria-hidden className="flex justify-center py-1">
                  <span className="flow-line" data-axis="y" data-live={live} />
                </li>
              )}
            </Fragment>
          ))}
        </ol>

        <div className="space-y-6">
          {/* Above the inspector: the inspector sticks while scrolling, and anything below it would slide underneath. */}
          <SessionPanel />
          <Panel className="p-5 xl:sticky xl:top-20">
            <div className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-3">
              <p className="font-mono text-sm font-semibold uppercase tracking-[0.12em] text-ink-hi">{NODES.find((n) => n.id === node)!.label}</p>
              <span className="text-xs text-ink-lo">live · {formatClock(state.clock)}</span>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={node} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="mt-4">
                <Inspector node={node} />
              </motion.div>
            </AnimatePresence>
          </Panel>
        </div>
      </div>
    </div>
  );
}

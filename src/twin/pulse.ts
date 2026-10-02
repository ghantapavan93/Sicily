import { clock, lowerFirst, one, plural, usd } from "./format";
import { SOURCES } from "./sources";
import { evaluate, type Evaluation, type TwinState } from "./runtime";
import type { Decision, TwinEvent } from "./types";

/*
 * The six engines, the Daily Pulse and the attention budget. All three are
 * readings of the same evaluation, so the animation, the headline and the
 * counts can never disagree with the decisions.
 */

/* ------------------------------------------------------------------ */
/* The six engines                                                     */
/* ------------------------------------------------------------------ */

export type EngineId = "observe" | "reconcile" | "understand" | "plan" | "guard" | "learn";

export const ENGINES: { id: EngineId; label: string; does: string }[] = [
  { id: "observe", label: "Observe", does: "Reads POS, reservations, schedule, inventory and supplier mail as events arrive." },
  { id: "reconcile", label: "Reconcile", does: "Finds duplicates, stale readings and sources that disagree." },
  { id: "understand", label: "Understand", does: "Builds tonight's service picture: covers, floor, stock, money." },
  { id: "plan", label: "Plan", does: "Turns the picture into staffing, purchasing and operating options." },
  { id: "guard", label: "Guard", does: "Checks authority, money, uncertainty and whether the evidence is enough." },
  { id: "learn", label: "Learn", does: "Records each decision and, once the night is over, what happened." },
];

export interface EngineTrace {
  event: TwinEvent | null;
  lines: Record<EngineId, string[]>;
}

const empty = (): Record<EngineId, string[]> => ({ observe: [], reconcile: [], understand: [], plan: [], guard: [], learn: [] });

/** What each engine did with the events processed between two states. */
export function traceOf(before: TwinState, after: TwinState): EngineTrace {
  const a = evaluate(before);
  const b = evaluate(after);
  const fresh = b.processed.filter((e) => !a.processed.some((x) => x.id === e.id));
  const lines = empty();
  const shown = fresh.filter((e) => !e.routine);
  const event = shown.at(-1) ?? fresh.at(-1) ?? null;

  for (const e of fresh) {
    if (e.routine) continue;
    lines.observe.push(`${e.kind} · ${SOURCES[e.source].label} · ${e.summary}`);
    const dup = b.twin.ledger.duplicates.find((d) => d.ignored === e.id);
    const conflict = b.twin.ledger.conflicts.find((c) => c.a.eventId === e.id || c.b.eventId === e.id);
    const unverified = b.twin.ledger.unverified.find((u) => u.eventId === e.id);
    if (dup) lines.reconcile.push(`Duplicate of ${dup.kept} ignored. ${dup.reason}`);
    else if (conflict) lines.reconcile.push(`Disagrees with the other count: ${conflict.a.value} vs ${conflict.b.value}. Unresolved.`);
    else if (unverified) lines.reconcile.push("Listed, not verified. Shown, not counted.");
    else lines.reconcile.push(`Fresh · ${SOURCES[e.source].label} inside its ${SOURCES[e.source].staleAfterMin}-minute window.`);
  }
  if (fresh.some((e) => e.routine)) lines.reconcile.push(`${plural(fresh.filter((e) => e.routine).length, "routine sync")} absorbed.`);
  for (const s of b.twin.ledger.stale) if (!a.twin.ledger.stale.some((x) => x.source === s.source)) lines.reconcile.push(`${SOURCES[s.source].label} marked stale: ${s.ageMin} minutes old.`);

  lines.understand.push(...twinDelta(a, b));
  const { plan, guard } = decisionDelta(a.decisions, b.decisions);
  lines.plan.push(...plan);
  lines.guard.push(...guard);
  return { event, lines };
}

function twinDelta(a: Evaluation, b: Evaluation): string[] {
  const out: string[] = [];
  const ta = a.twin;
  const tb = b.twin;
  if (ta.demand.booked?.value !== tb.demand.booked?.value && tb.demand.booked) out.push(`Covers ${ta.demand.booked?.value ?? "—"} → ${tb.demand.booked.value}`);
  if (ta.demand.peakCovers !== tb.demand.peakCovers) out.push(`Peak ${ta.demand.peakCovers === null ? "—" : Math.round(ta.demand.peakCovers)} → ${tb.demand.peakCovers === null ? "unknown" : Math.round(tb.demand.peakCovers)} covers an hour`);
  if (ta.staffing.servers !== tb.staffing.servers) out.push(`Servers ${ta.staffing.servers} → ${tb.staffing.servers}`);
  if (ta.staffing.peakLoad !== tb.staffing.peakLoad && tb.staffing.peakLoad !== null) out.push(`Peak load ${ta.staffing.peakLoad === null ? "—" : one(ta.staffing.peakLoad)} → ${one(tb.staffing.peakLoad)} per server`);
  if (ta.labor.projectedSales !== tb.labor.projectedSales) out.push(tb.labor.projectedSales === null ? "Sales projection withdrawn" : `Sales projection ${usd(tb.labor.projectedSales)}`);
  for (const item of tb.inventory) {
    const was = ta.inventory.find((i) => i.item === item.item);
    if (was?.status !== item.status) out.push(`${item.name}: ${item.status.replace(/_/g, " ")}`);
  }
  if (tb.invoices.length > ta.invoices.length) {
    const inv = tb.invoices.at(-1)!;
    out.push(`${inv.vendor}: ${inv.verdict === "in_line" ? "in line with contract" : `${Math.round(inv.deltaPct)}% over contract (${inv.verdict})`}`);
  }
  if (tb.deliveries.length > ta.deliveries.length) out.push(`Delivery short ${tb.deliveries.at(-1)!.short}`);
  return out.length ? out : ["No change to tonight's picture."];
}

function decisionDelta(before: Decision[], after: Decision[]): { plan: string[]; guard: string[] } {
  const plan: string[] = [];
  const guard: string[] = [];
  for (const d of after) {
    const old = before.find((x) => x.key === d.key);
    if (old && old.status === d.status && old.recommendation?.action === d.recommendation?.action) continue;
    plan.push(`${d.id} ${old ? "revised" : "created"} · ${d.status.replace("_", " ")} · ${d.recommendation?.action ?? d.title}`);
    guard.push(
      `${d.id} · ${d.guard.evidenceSufficient ? "evidence sufficient" : "evidence insufficient"} · ${d.guard.requiresApproval ? `needs the ${d.authority.role.toLowerCase()}` : "no approval needed"} · external action not allowed`,
    );
  }
  for (const old of before) if (!after.some((d) => d.key === old.key)) plan.push(`${old.id} closed`);
  return { plan, guard };
}

/* ------------------------------------------------------------------ */
/* Daily Pulse                                                         */
/* ------------------------------------------------------------------ */

export interface Pulse {
  tone: "calm" | "reading" | "changed" | "handled" | "closed";
  headline: string;
  sub: string;
  counts: { decisions: number; missing: number; canWait: number; open: number };
}

const OPEN = new Set<Decision["status"]>(["recommend", "held", "conflict", "needs_fact", "deferred", "watching"]);

function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export function pulseOf(state: TwinState): Pulse {
  const e = evaluate(state);
  const s = e.scenario;
  // Each card is counted once: a decision waiting on a missing fact is the missing fact, not also a decision.
  const missing = e.decisions.filter((d) => d.status === "needs_fact").length;
  const decisions = e.decisions.filter((d) => d.lane !== "can_wait" && d.status !== "resolved" && d.status !== "needs_fact").length;
  const canWait = e.decisions.filter((d) => d.lane === "can_wait").length;
  const needsNow = e.decisions.filter((d) => d.lane !== "can_wait" && OPEN.has(d.status));
  const counts = { decisions, missing, canWait, open: needsNow.length };
  const waiting = e.timeline.filter((x) => x.availableAt >= s.burstFrom && x.availableAt <= state.clock && !x.routine).length;

  switch (state.phase) {
    case "idle":
    case "arriving":
      return { tone: "calm", headline: "Today is tracking near plan.", sub: waiting ? `${plural(waiting, "new signal")} since ${clock(s.openAt)}.` : `${s.plan.covers} covers planned. Doors at ${clock(s.doorsAt)}.`, counts };
    case "waiting":
      return { tone: "calm", headline: "Today is tracking near plan.", sub: `${plural(waiting, "new signal")} since ${clock(s.openAt)}. Savy hasn't read them yet.`, counts };
    case "processing":
      return { tone: "reading", headline: "Savy is reading what arrived.", sub: `${e.processed.filter((x) => x.availableAt >= s.burstFrom && !x.routine).length} of ${waiting} signals read.`, counts };
    case "closed":
    case "remembered":
      return { tone: "closed", headline: `Service closed at ${clock(s.closeAt)}.`, sub: state.outcome?.lessons[0] ?? "", counts };
    case "live": {
      if (e.decisions.length === 0) return { tone: "calm", headline: "Tonight is on plan.", sub: "Nothing needs you. Savy is watching.", counts };
      const handled = e.decisions.filter((d) => d.lane !== "can_wait" && !OPEN.has(d.status)).length;
      // Decisions closed by evidence still count: they were on the owner's list until the floor answered.
      const total = e.decisions.filter((d) => d.lane !== "can_wait").length;
      if (handled === 0) {
        const parts: string[] = [];
        if (decisions) parts.push(plural(decisions, "decision"));
        if (missing) parts.push(plural(missing, "missing fact"));
        if (canWait) parts.push(`${canWait} ${canWait === 1 ? "thing that can" : "things that can"} wait`);
        return { tone: "changed", headline: "Tonight changed.", sub: `Your original service plan is no longer the plan I would use. I found ${listOf(parts)}.`, counts };
      }
      if (needsNow.length > 0) {
        const next = [...needsNow].sort((x, y) => (x.urgency.by ?? Infinity) - (y.urgency.by ?? Infinity))[0]!;
        return {
          tone: "handled",
          headline: `${handled} of ${total} handled.`,
          sub: `${needsNow.length === 1 ? "One still needs" : `${needsNow.length} still need`} you. Next: ${lowerFirst(next.title)}${next.urgency.by ? `, ${lowerFirst(next.urgency.label)}` : ""}.`,
          counts,
        };
      }
      return { tone: "handled", headline: "Nothing needs you right now.", sub: `Savy is watching ${plural(canWait, "thing")}.`, counts };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Attention budget                                                    */
/* ------------------------------------------------------------------ */

export interface Attention {
  signals: number;
  changedDecision: number;
  needsYou: number;
  hidden: { what: string; why: string; at: number }[];
}

/** Intelligence is protecting the owner from information: how much arrived, how little needed them. */
export function attentionOf(state: TwinState): Attention {
  const e = evaluate(state);
  const cited = new Set(e.decisions.flatMap((d) => d.evidence.map((x) => x.eventId)));
  for (const v of Object.values(state.versions)) for (const x of v) for (const ev of e.processed) if (x.cause.startsWith(ev.kind) && x.cause.endsWith(clock(ev.availableAt))) cited.add(ev.id);
  const dupIds = new Set(e.twin.ledger.duplicates.map((d) => d.ignored));
  const hidden: Attention["hidden"] = [];
  for (const ev of e.arrived) {
    if (dupIds.has(ev.id)) hidden.push({ what: ev.summary, why: "Duplicate of a fact already counted.", at: ev.availableAt });
    else if (ev.routine) hidden.push({ what: ev.summary, why: "Routine sync. Nothing changed.", at: ev.availableAt });
    else if (!cited.has(ev.id) && !e.decisions.some((d) => d.whatChanged.some((w) => w.includes(ev.summary.split(":")[0] ?? "")))) {
      hidden.push({ what: ev.summary, why: "Read and understood. It didn't change a decision.", at: ev.availableAt });
    }
  }
  for (const o of e.observations.filter((x) => !x.counted && (x.specialist === "demand" || x.specialist === "finance" || x.specialist === "supply"))) {
    hidden.push({ what: o.text, why: "Noted, not counted.", at: state.processedThrough });
  }
  return {
    signals: e.arrived.length,
    changedDecision: e.arrived.filter((ev) => cited.has(ev.id) && !dupIds.has(ev.id)).length,
    needsYou: e.decisions.filter((d) => d.lane !== "can_wait" && OPEN.has(d.status)).length,
    hidden: hidden.sort((x, y) => y.at - x.at),
  };
}

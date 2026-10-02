import { forkOf, type Fork } from "./consequence";
import { latest } from "./ledger";
import { signedUsd, usd } from "./format";
import { evaluate, type Evaluation, type TwinState } from "./runtime";
import type { Decision, EventOf, FaultId, ItemId, TwinEvent } from "./types";

/*
 * Fork this night. Change one assumption, rerun the same engine on a copy of
 * tonight, and see which decisions move and which don't. Nothing here
 * touches the live state: a fork is a hypothetical, and it is labelled so.
 */

export interface Assumptions {
  /** Booked covers, as if the book said this instead. */
  covers?: number;
  /** Backup stock, as if the walk-in had been counted. */
  backup?: Partial<Record<ItemId, number>>;
  onCallDeclines?: boolean;
  eventCancelled?: boolean;
  /** Extra faults to dry-run on top of tonight's. */
  faults?: FaultId[];
}

export interface DecisionChange {
  key: string;
  id: string;
  title: string;
  before: string | null;
  after: string | null;
}

export interface NightFork {
  base: Evaluation;
  fork: Evaluation;
  changed: DecisionChange[];
  unchanged: { key: string; id: string; title: string }[];
  figures: { label: string; before: string; after: string }[];
  nights: { base: Fork | null; fork: Fork | null };
}

const summary = (d: Decision | undefined) => (d ? `${d.status.replace("_", " ")} · ${d.recommendation?.action ?? d.headline}` : null);

export function hypothetical(state: TwinState, a: Assumptions): TwinState {
  const base = evaluate(state);
  const at = state.processedThrough;
  const extra: TwinEvent[] = [];
  const stamp = (id: string) => ({ id: `evt_whatif_${id}`, occurredAt: at, availableAt: at, dedupeKey: `whatif:${id}`, routine: false, cause: "what-if" });

  if (a.covers !== undefined) {
    extra.push({ ...stamp("covers"), kind: "reservations.updated", source: "reservations", summary: `What if: the book says ${a.covers}.`, payload: { covers: Math.max(0, Math.round(a.covers)), system: "book" } });
  }
  for (const [item, n] of Object.entries(a.backup ?? {}) as [ItemId, number][]) {
    extra.push({ ...stamp(`backup_${item}`), kind: "inventory.count", source: "inventory", summary: `What if: ${n} ${item} in backup.`, payload: { item, place: "backup", onHand: n, reportedBy: "manager" } });
  }
  if (a.onCallDeclines) {
    const schedule = latest(base.processed, "schedule.published");
    if (schedule) extra.push({ ...(schedule as EventOf<"schedule.published">), ...stamp("oncall"), summary: "What if: nobody is on call.", payload: { ...schedule.payload, onCall: null } });
  }
  const dropped = a.eventCancelled ? base.processed.filter((e) => e.kind === "event.listed").map((e) => e.id) : [];
  const faults = [...new Set([...state.faults, ...(a.faults ?? [])])];
  return {
    ...state,
    phase: state.phase === "processing" || state.phase === "waiting" || state.phase === "arriving" ? "live" : state.phase,
    faults,
    caused: [...state.caused, ...extra],
    dropped: [...(state.dropped ?? []), ...dropped],
  };
}

export function forkNight(state: TwinState, a: Assumptions): NightFork {
  const base = evaluate(state);
  const fork = evaluate(hypothetical(state, a));
  const keys = [...new Set([...base.decisions.map((d) => d.key), ...fork.decisions.map((d) => d.key)])];
  const changed: DecisionChange[] = [];
  const unchanged: NightFork["unchanged"] = [];
  for (const key of keys) {
    const b = base.decisions.find((d) => d.key === key);
    const f = fork.decisions.find((d) => d.key === key);
    const ref = f ?? b!;
    if (summary(b) === summary(f)) unchanged.push({ key, id: ref.id, title: ref.title });
    else changed.push({ key, id: ref.id, title: ref.title, before: summary(b), after: summary(f) });
  }

  const tb = base.twin;
  const tf = fork.twin;
  const fig = (n: number | null, digits = 1) => (n === null ? "unknown" : n.toFixed(digits));
  const figures = [
    { label: "Covers booked", before: `${tb.demand.booked?.value ?? "unknown"}`, after: `${tf.demand.booked?.value ?? "unknown"}` },
    { label: "Peak covers per server", before: fig(tb.staffing.peakLoad), after: fig(tf.staffing.peakLoad) },
    { label: "Labor", before: tb.labor.pct === null ? "unknown" : `${tb.labor.pct.toFixed(1)}%`, after: tf.labor.pct === null ? "unknown" : `${tf.labor.pct.toFixed(1)}%` },
    { label: "Tomorrow's order", before: `${tb.purchasing.total < 0 ? "−" : ""}${usd(tb.purchasing.total)}`, after: `${tf.purchasing.total < 0 ? "−" : ""}${usd(tf.purchasing.total)}` },
    { label: "Proposed cash effect", before: signedUsd(tb.cash.proposedDelta), after: signedUsd(tf.cash.proposedDelta) },
  ].filter((x) => x.before !== x.after);

  return {
    base,
    fork,
    changed,
    unchanged,
    figures,
    nights: { base: forkOf(base.scenario, base.twin, base.decisions), fork: forkOf(fork.scenario, fork.twin, fork.decisions) },
  };
}

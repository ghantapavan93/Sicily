import { formatClock, type Minutes } from "@/domain/clock";
import type { Basis } from "@/domain/types";
import { HOUSE } from "@/domain/venue";
import { loadPerServer, peakCoversFor } from "@/twin/twin";
import { REPLAY_WINDOW, SITUATIONS } from "./history";
import type {
  Agreement,
  Classification,
  OperatorAction,
  ReplayEvent,
  Situation,
  SituationKind,
  SituationParams,
} from "./types";

/* ------------------------------------------------------------------ */
/* What Savy would have said, per kind of situation                    */
/* ------------------------------------------------------------------ */

type ParamsOf<K extends SituationKind> = Extract<SituationParams, { kind: K }>;

interface EvidenceLine {
  /** Minutes before detection at which this became available. */
  before: number;
  source: string;
  basis: Basis;
  text: string;
}

interface KindSpec<K extends SituationKind> {
  label: string;
  /** Owner-level situations can reach the owner's queue. The rest go to the manager's list. */
  ownerLevel: boolean;
  /** The operator action that counts as agreeing with Savy. */
  recommended: OperatorAction;
  title(p: ParamsOf<K>): string;
  detected(p: ParamsOf<K>): string;
  recommendation(p: ParamsOf<K>): string;
  evidence(p: ParamsOf<K>): EvidenceLine[];
  /** What Savy could not see at the time. */
  missing(p: ParamsOf<K>): string[];
}

const one = (n: number) => n.toFixed(1);

const KINDS: { [K in SituationKind]: KindSpec<K> } = {
  coverage_gap: {
    label: "Coverage",
    ownerLevel: true,
    recommended: "added_server",
    title: (p) => `Short on the floor for ${p.covers} covers`,
    detected: (p) =>
      `About ${one(loadPerServer(peakCoversFor(p.covers), p.servers))} covers per server at the peak, against a ceiling of ${HOUSE.loadCeiling}.`,
    recommendation: () => "Offer a short shift to an on-call server.",
    evidence: (p) => [
      { before: 150, source: "Schedule", basis: "scheduled", text: `Published roster: ${p.scheduled} servers.` },
      { before: 24, source: "Reservations", basis: "expected", text: `${p.covers} covers booked. A usual night books ${p.usual}.` },
      ...(p.callout
        ? [{ before: 6, source: "Schedule", basis: "actual" as Basis, text: `A server called out. ${p.scheduled} servers became ${p.servers}.` }]
        : []),
      { before: 3, source: "POS", basis: "actual", text: "Sales since open were on or ahead of plan." },
    ],
    missing: () => ["Walk-ins. Estimated from comparable nights."],
  },
  prep_shortfall: {
    label: "Prep",
    ownerLevel: true,
    recommended: "prepped_more",
    title: (p) => `${p.item} likely to run out`,
    detected: (p) => `About ${p.expected} orders expected against ${p.onHand} on hand.`,
    recommendation: (p) => `Prep or restock ${p.item.toLowerCase()} before service.`,
    evidence: (p) => [
      { before: 35, source: "Inventory", basis: "actual", text: `Afternoon count: ${p.onHand} ${p.item.toLowerCase()}.` },
      { before: 10, source: "Reservations", basis: "estimated", text: `About ${p.expected} orders expected from the booked covers and the usual mix.` },
    ],
    missing: () => ["Waste and comps since the count."],
  },
  overtime_drift: {
    label: "Overtime",
    ownerLevel: true,
    recommended: "cut_early",
    title: (p) => `A ${p.role} heading into overtime`,
    detected: (p) => `On track for ${p.projected} hours this week. At ${p.weekHours} now.`,
    recommendation: () => "End the shift early if the floor allows.",
    evidence: (p) => [
      { before: 300, source: "Schedule", basis: "scheduled", text: `A ${p.role} is scheduled to close.` },
      { before: 4, source: "Timeclock", basis: "actual", text: `${p.weekHours} hours worked this week.` },
    ],
    missing: () => ["Whether the floor can spare the position."],
  },
  invoice_variance: {
    label: "Invoice",
    ownerLevel: true,
    recommended: "reviewed_invoice",
    title: (p) => `${p.item} priced ${p.variancePct}% above recent invoices`,
    detected: (p) => `${p.supplier}: ${p.item.toLowerCase()} is ${p.variancePct}% above the last three invoices.`,
    recommendation: () => "Review the invoice before it is entered.",
    evidence: (p) => [
      { before: 2000, source: "Invoices", basis: "actual", text: `The last three ${p.supplier} invoices for the same item.` },
      { before: 12, source: "Invoices", basis: "actual", text: `Invoice photo received from ${p.supplier}.` },
    ],
    missing: () => ["Whether the pack size changed."],
  },
  beverage_overorder: {
    label: "Ordering",
    ownerLevel: true,
    recommended: "reduced_order",
    title: (p) => `Beverage order ${p.overParPct}% above par`,
    detected: (p) => `A $${p.orderUsd.toLocaleString("en-US")} draft order is ${p.overParPct}% above par and four-week usage.`,
    recommendation: () => "Reduce the order to par.",
    evidence: (p) => [
      { before: 4000, source: "Owner", basis: "owner_set", text: "Par levels set by the owner." },
      { before: 60, source: "POS", basis: "actual", text: "Four-week beverage usage." },
      { before: 20, source: "Ordering", basis: "scheduled", text: `Draft order: $${p.orderUsd.toLocaleString("en-US")}.` },
    ],
    missing: () => ["Private bookings. They live on paper contracts, not in a connected source."],
  },
  stale_source: {
    label: "Source health",
    ownerLevel: false,
    recommended: "restarted_sync",
    title: (p) => `${p.source} silent for ${p.ageMin} minutes`,
    detected: (p) => `No ${p.source} reading for ${p.ageMin} minutes during service.`,
    recommendation: () => "Restart the sync. Hold labor and ordering suggestions until it answers.",
    evidence: (p) => [
      { before: p.ageMin, source: p.source, basis: "actual", text: `Last ${p.source} reading.` },
    ],
    missing: (p) => [`Everything ${p.source} would have reported since.`],
  },
  late_clockin: {
    label: "Timeclock",
    ownerLevel: false,
    recommended: "fixed_punch",
    title: (p) => `No clock-in for a ${p.role}, ${p.lateMin} minutes in`,
    detected: (p) => `A ${p.role} shift started ${p.lateMin} minutes ago with no punch.`,
    recommendation: () => "Confirm the punch with the manager. Facts only: never a score or an employment action.",
    evidence: (p) => [
      { before: 200, source: "Schedule", basis: "scheduled", text: `A ${p.role} shift on the published roster.` },
      { before: 1, source: "Timeclock", basis: "actual", text: "No punch recorded for that shift." },
    ],
    missing: () => ["Whether the person is on the floor and unpunched."],
  },
  comp_void_spike: {
    label: "Checks",
    ownerLevel: false,
    recommended: "reviewed_checks",
    title: (p) => `${p.count} voids and comps against a usual ${p.usual}`,
    detected: (p) => `Voids and comps are at ${p.count} tonight. A usual night has ${p.usual}.`,
    recommendation: () => "Review the checks with the manager on duty.",
    evidence: (p) => [
      { before: 2, source: "POS", basis: "actual", text: `${p.count} voids and comps so far tonight.` },
    ],
    missing: () => ["The reason codes. They are entered at close."],
  },
};

/** Narrows a spec to its situation's params. The union is keyed by `kind`, so this is safe. */
function specOf(s: Situation): KindSpec<SituationKind> {
  return KINDS[s.params.kind] as unknown as KindSpec<SituationKind>;
}

export const kindLabel = (s: Situation) => specOf(s).label;
export const isOwnerLevel = (s: Situation) => specOf(s).ownerLevel;
export const titleOf = (s: Situation) => specOf(s).title(s.params);
export const detectedOf = (s: Situation) => specOf(s).detected(s.params);
export const recommendationOf = (s: Situation) => specOf(s).recommendation(s.params);
export const missingOf = (s: Situation) => specOf(s).missing(s.params);

export const OPERATOR_LABEL: Record<OperatorAction, string> = {
  added_server: "Added a server",
  expanded_sections: "Expanded sections instead",
  prepped_more: "Prepped or restocked",
  cut_early: "Ended the shift early",
  reviewed_invoice: "Reviewed the invoice",
  reduced_order: "Reduced the order",
  kept_order: "Kept the order as drafted",
  restarted_sync: "Restarted the sync",
  fixed_punch: "Corrected the punch",
  reviewed_checks: "Reviewed the checks",
  none: "Nobody acted",
};

/* ------------------------------------------------------------------ */
/* The rules. Each count on screen is one of these applied to the rows */
/* ------------------------------------------------------------------ */

/** Dollars at stake below which an owner-level situation stays with the manager. */
export const SURFACE_MIN_USD = 60;

/** Would this have reached the owner's queue as a recommendation? */
export function wouldSurface(s: Situation): boolean {
  return specOf(s).ownerLevel && s.impactUsd >= SURFACE_MIN_USD;
}

export function classify(s: Situation): Classification {
  // Staff acted before Savy would have noticed.
  if (s.operator.at !== null && s.operator.at <= s.detectedAt) return "already_handled";
  // Nothing came of it, and nobody acted the way Savy would have suggested.
  const actedAsSuggested = s.operator.action === specOf(s).recommended;
  if (!s.result.materialized && !actedAsSuggested) return "noise";
  return "useful";
}

/** For surfaced recommendations only: did the operator do what Savy would have said? */
export function agreementOf(s: Situation): Agreement | null {
  if (!wouldSurface(s)) return null;
  return s.operator.action === specOf(s).recommended ? "agree" : "disagree";
}

export const CLASSIFICATION_RULE: Record<Classification, string> = {
  already_handled: "The operator acted at or before the time Savy would have noticed.",
  noise: "The risk did not materialize, and nobody acted the way Savy would have suggested.",
  useful: "The risk was real, or the operator later did what Savy would have suggested.",
};

export interface ShadowSummary {
  services: number;
  detected: number;
  useful: number;
  alreadyHandled: number;
  noise: number;
  surfaced: number;
  agree: number;
  disagree: number;
  /** Surfaced recommendations that turned out to be noise. The cost of listening. */
  surfacedNoise: number;
}

export function summarize(situations: readonly Situation[] = SITUATIONS, services = 30): ShadowSummary {
  const count = (c: Classification) => situations.filter((s) => classify(s) === c).length;
  const surfaced = situations.filter(wouldSurface);
  return {
    services,
    detected: situations.length,
    useful: count("useful"),
    alreadyHandled: count("already_handled"),
    noise: count("noise"),
    surfaced: surfaced.length,
    agree: surfaced.filter((s) => agreementOf(s) === "agree").length,
    disagree: surfaced.filter((s) => agreementOf(s) === "disagree").length,
    surfacedNoise: surfaced.filter((s) => classify(s) === "noise").length,
  };
}

/* ------------------------------------------------------------------ */
/* Replay                                                              */
/* ------------------------------------------------------------------ */

/**
 * A staff action is often known to the restaurant before it is known to any
 * system. When a person acted before Savy's detection time, the record of it
 * reached a connected source only later. That gap is why "already handled"
 * can be measured without leaking the future into the replay.
 */
const RECORD_LAG_MIN = 40;

export function replayEventsFor(s: Situation): ReplayEvent[] {
  const spec = specOf(s);
  const events: ReplayEvent[] = [];

  spec.evidence(s.params).forEach((line, i) => {
    const time = Math.max(REPLAY_WINDOW.opens, s.detectedAt - line.before);
    events.push({
      id: `${s.id}:ev${i}`,
      situationId: s.id,
      role: "evidence",
      availableAt: time,
      occurredAt: time,
      source: line.source,
      basis: line.basis,
      text: line.text,
    });
  });

  events.push({
    id: `${s.id}:detect`,
    situationId: s.id,
    role: "detection",
    availableAt: s.detectedAt,
    occurredAt: s.detectedAt,
    source: "Savy",
    basis: "estimated",
    text: spec.detected(s.params),
  });

  if (s.operator.at !== null) {
    const actedBefore = s.operator.at <= s.detectedAt;
    events.push({
      id: `${s.id}:operator`,
      situationId: s.id,
      role: "operator",
      availableAt: actedBefore ? s.detectedAt + RECORD_LAG_MIN : s.operator.at,
      occurredAt: s.operator.at,
      source: "Operator",
      basis: "actual",
      text: `${OPERATOR_LABEL[s.operator.action]} at ${formatClock(s.operator.at)}.${s.operator.reason ? ` Reason: "${s.operator.reason}"` : ""}`,
    });
  }

  events.push({
    id: `${s.id}:result`,
    situationId: s.id,
    role: "result",
    availableAt: REPLAY_WINDOW.closes,
    occurredAt: REPLAY_WINDOW.closes,
    source: "Close",
    basis: "actual",
    text: s.result.note,
  });

  return events.sort((a, b) => a.availableAt - b.availableAt);
}

export function situationsOf(service: number, situations: readonly Situation[] = SITUATIONS): Situation[] {
  return situations.filter((s) => s.service === service).sort((a, b) => a.detectedAt - b.detectedAt);
}

export function serviceEvents(service: number): ReplayEvent[] {
  return situationsOf(service)
    .flatMap(replayEventsFor)
    .sort((a, b) => a.availableAt - b.availableAt || a.id.localeCompare(b.id));
}

/** The same rule as the live engine: only what had arrived by `clock`. */
export function replayAt(events: readonly ReplayEvent[], clock: Minutes): { visible: ReplayEvent[]; hidden: ReplayEvent[] } {
  return {
    visible: events.filter((e) => e.availableAt <= clock),
    hidden: events.filter((e) => e.availableAt > clock),
  };
}

/** What Savy could and could not have used for one situation at its detection time. */
export function knowableFor(s: Situation): { knowable: ReplayEvent[]; arrivedLater: ReplayEvent[] } {
  const events = replayEventsFor(s).filter((e) => e.role !== "detection");
  const { visible, hidden } = replayAt(events, s.detectedAt);
  return { knowable: visible, arrivedLater: hidden };
}

export function findSituation(id: string): Situation | undefined {
  return SITUATIONS.find((s) => s.id === id);
}

import type { Minutes } from "@/domain/clock";
import type { Freshness } from "@/domain/types";
import { SOURCE_ORDER, SOURCES } from "./sources";
import type { EventOf, FaultId, Reading, ReconcileReport, Scenario, SourceHealth, SourceId, TwinEvent } from "./types";
import { byText } from "./sort";

/* ------------------------------------------------------------------ */
/* Faults                                                              */
/* ------------------------------------------------------------------ */

export interface FaultSpec {
  label: string;
  what: string;
  /** What Savy promises to do when this happens. Checked live and in the lab. */
  promise: string;
  /** The reliability principle the fault teaches. */
  principle: string;
}

export const FAULTS: Record<FaultId, FaultSpec> = {
  pos_delayed: {
    label: "POS sync delayed",
    what: "Sales stop syncing before the burst.",
    promise: "The coverage risk stays. Every conclusion that needs current sales is withdrawn.",
    principle: "Remove only what the missing source supported.",
  },
  reservations_disagree: {
    label: "Reservation sources disagree",
    what: "The host stand's count arrives and does not match the book.",
    promise: "Savy won't choose between them. Everything that depends on the cover count is held.",
    principle: "A disagreement blocks its dependents, not the whole night.",
  },
  invoice_duplicated: {
    label: "Invoice delivered twice",
    what: "The supplier's email arrives twice with the same invoice.",
    promise: "One invoice is kept. Purchasing and cash totals don't change.",
    principle: "The same fact twice is still one fact.",
  },
  inventory_missing: {
    label: "Inventory count missing",
    what: "This afternoon's counts were never entered.",
    promise: "Savy asks a person for a count. It never invents one.",
    principle: "Unknown is not zero.",
  },
  vendor_timeout: {
    label: "Vendor system times out",
    what: "Submitting an order returns no answer.",
    promise: "Savy won't retry blindly. It reconciles first, so there is never a second order.",
    principle: "An unknown outcome is reconciled before anything is retried.",
  },
  manager_rejects: {
    label: "Manager overrules the plan",
    what: "The manager rejects an approved staffing change.",
    promise: "The schedule isn't changed. The disagreement is recorded and compared at close.",
    principle: "People on the floor outrank the model. Disagreements are data.",
  },
};

export const FAULT_ORDER: FaultId[] = [
  "pos_delayed",
  "reservations_disagree",
  "invoice_duplicated",
  "inventory_missing",
  "vendor_timeout",
  "manager_rejects",
];

/** How long before the burst the POS goes quiet when it is delayed. */
const POS_SILENCE_MIN = 18;
/** The host stand's count runs this far below the book when the sources disagree. */
const HOST_SHARE = 0.85;

/**
 * The night's events, with the faults applied. Faults change what arrives,
 * never how the engine reads it.
 */
export function timelineOf(scenario: Scenario, faults: readonly FaultId[]): TwinEvent[] {
  let events = [...scenario.events];
  const inBurst = (e: TwinEvent) => e.availableAt >= scenario.burstFrom;

  if (faults.includes("pos_delayed")) {
    const lastGood = scenario.burstFrom - POS_SILENCE_MIN;
    events = events.filter((e) => e.source !== "pos" || e.availableAt <= lastGood);
  }

  if (faults.includes("inventory_missing")) {
    events = events.filter((e) => !(e.kind === "inventory.count" && inBurst(e)));
  }

  if (faults.includes("reservations_disagree")) {
    // The host stand exports its own count late in the afternoon, after the book's last update.
    const book = [...events].reverse().find((e): e is EventOf<"reservations.updated"> => e.kind === "reservations.updated" && e.payload.system === "book");
    if (book) {
      const covers = Math.round(book.payload.covers * HOST_SHARE);
      const at = Math.max(book.availableAt + 1, scenario.decideAt - 3);
      events.push({
        ...book,
        id: `${book.id}_host`,
        availableAt: at,
        occurredAt: at,
        dedupeKey: `${book.id}_host`,
        payload: { covers, system: "host" },
        summary: `Host stand export: ${covers} covers.`,
      });
    }
  }

  if (faults.includes("invoice_duplicated")) {
    const invoice = events.find((e): e is EventOf<"invoice.received"> => e.kind === "invoice.received" && inBurst(e));
    if (invoice) {
      events.push({ ...invoice, id: `${invoice.id}_dup`, availableAt: invoice.availableAt + 2, summary: `${invoice.summary} (delivered again)` });
    }
  }

  return events.sort((a, b) => a.availableAt - b.availableAt || byText(a.id, b.id));
}

/** The single leakage rule: nothing is known before it arrives. Used live, in replay and in the lab. */
export const knowableAt = (events: readonly TwinEvent[], clock: Minutes) => events.filter((e) => e.availableAt <= clock);

/* ------------------------------------------------------------------ */
/* Reconcile                                                           */
/* ------------------------------------------------------------------ */

const ageOf = (at: Minutes, clock: Minutes) => Math.max(0, clock - at);

export function freshnessOf(source: SourceId, at: Minutes | null, clock: Minutes): Freshness {
  if (at === null) return "missing";
  return ageOf(at, clock) > SOURCES[source].staleAfterMin ? "stale" : "fresh";
}

export function readingOf<T>(event: TwinEvent, value: T, clock: Minutes, basis: Reading<T>["basis"]): Reading<T> {
  return {
    value,
    at: event.availableAt,
    eventId: event.id,
    source: event.source,
    basis,
    freshness: freshnessOf(event.source, event.availableAt, clock),
  };
}

const DUPLICATE_REASON: Partial<Record<TwinEvent["kind"], string>> = {
  "invoice.received": "Same vendor, same invoice number, same amount, same period.",
  "staff.callout": "Same person, same shift, same message, sent again by the app.",
};

/** The first delivery of each fact, and the later copies that were set aside. */
export function dedupe(events: readonly TwinEvent[]): { kept: TwinEvent[]; duplicates: ReconcileReport["duplicates"] } {
  const seen = new Map<string, TwinEvent>();
  const kept: TwinEvent[] = [];
  const duplicates: ReconcileReport["duplicates"] = [];
  for (const e of events) {
    const first = seen.get(e.dedupeKey);
    if (first) {
      duplicates.push({ kept: first.id, ignored: e.id, reason: DUPLICATE_REASON[e.kind] ?? "Same fact delivered again." });
      continue;
    }
    seen.set(e.dedupeKey, e);
    kept.push(e);
  }
  return { kept, duplicates };
}

export function healthOf(events: readonly TwinEvent[], clock: Minutes): SourceHealth[] {
  return SOURCE_ORDER.map((source) => {
    const last = events.filter((e) => e.source === source).reduce<Minutes | null>((m, e) => (m === null || e.availableAt > m ? e.availableAt : m), null);
    return { source, last, ageMin: last === null ? null : ageOf(last, clock), freshness: freshnessOf(source, last, clock) };
  });
}

/** The latest event of a kind that matches, or null. */
export function latest<K extends TwinEvent["kind"]>(events: readonly TwinEvent[], kind: K, match: (e: EventOf<K>) => boolean = () => true): EventOf<K> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as TwinEvent;
    if (e.kind === kind && match(e as EventOf<K>)) return e as EventOf<K>;
  }
  return null;
}

/** Two cover counts more than this far apart are a disagreement, not rounding. */
export const COVER_TOLERANCE = 0.05;

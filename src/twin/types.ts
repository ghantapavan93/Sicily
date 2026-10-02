import type { Minutes } from "@/domain/clock";
import type { Basis, ConfidenceLevel, Freshness } from "@/domain/types";

/*
 * The restaurant twin's vocabulary.
 *
 *   incoming events → event ledger → reconcile → twin → specialists → decisions → guard → people
 *
 * Every screen in the product is a projection of these types. Nothing on
 * screen holds state of its own about the restaurant.
 */

/* ------------------------------------------------------------------ */
/* Sources and events                                                  */
/* ------------------------------------------------------------------ */

/** Generic system names, as OPSAVOR uses them. No vendor is implied. */
export type SourceId = "pos" | "reservations" | "schedule" | "staff" | "inventory" | "suppliers" | "bank" | "events";

export type ItemId = "burrata" | "branzino" | "greens";

export interface Shift {
  id: string;
  name: string;
  role: "server";
  start: Minutes;
  end: Minutes;
}

export interface InvoiceLine {
  item: string;
  qty: number;
  unitPrice: number;
  /** What the contract says this line should cost per unit. */
  contractPrice: number;
  /** The quantity the restaurant usually orders. */
  usualQty: number;
}

export interface Invoice {
  vendor: string;
  number: string;
  period: string;
  lines: InvoiceLine[];
  /** Totals of the last four invoices from this vendor, oldest first. */
  previousTotals: number[];
}

interface Payloads {
  "schedule.published": { shifts: Shift[]; onCall: { id: string; name: string } | null };
  "reservations.updated": { covers: number; system: "book" | "host" };
  "staff.callout": { shiftId: string };
  "sales.updated": { soFar: number; planSoFar: number };
  "inventory.count": { item: ItemId; place: "line" | "backup"; onHand: number; reportedBy: "system" | "manager" };
  "inventory.expected": { item: ItemId; onHand: number };
  "invoice.received": Invoice;
  "delivery.received": { vendor: string; item: ItemId; ordered: number; received: number; unitCost: number; portionsPerUnit: number };
  "event.listed": { name: string; endsAt: Minutes; distanceMi: number; extraWalkIns: number };
  "bank.synced": { balance: number };
  "sync.heartbeat": { note: string };
  "vendor.order": { orderId: string; status: "submitted" | "confirmed" | "unknown" | "found" };
}

export type EventKind = keyof Payloads;

interface EventBase {
  id: string;
  source: SourceId;
  /** When it happened in the world. */
  occurredAt: Minutes;
  /** When it reached the restaurant's systems. Nothing may use an event before this. */
  availableAt: Minutes;
  /** Two deliveries of the same fact share a key. The second is a duplicate. */
  dedupeKey: string;
  /** A sync that changed nothing. Counted in the attention budget, then hidden. */
  routine: boolean;
  summary: string;
  /** Present on events a person caused from the screen. */
  cause?: string;
}

export type TwinEvent = { [K in EventKind]: EventBase & { kind: K; payload: Payloads[K] } }[EventKind];
export type EventOf<K extends EventKind> = Extract<TwinEvent, { kind: K }>;

/* ------------------------------------------------------------------ */
/* Scenarios and faults                                                */
/* ------------------------------------------------------------------ */

export type ScenarioId = "friday_rush" | "supplier_problem" | "slow_night";

export type FaultId =
  | "pos_delayed"
  | "reservations_disagree"
  | "invoice_duplicated"
  | "inventory_missing"
  | "vendor_timeout"
  | "manager_rejects";

export interface ItemSpec {
  name: string;
  /** Portions ordered per cover on this kind of night, from sample history. */
  mix: number;
  unitCost: number;
  /** Already on tomorrow's standing order. */
  standing: number;
  /** What a manager finds when asked to look. The engine never reads this until someone is asked. */
  truth: { line: number; backup: number };
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  tagline: string;
  day: string;
  service: string;
  /** The twin opens here, with the morning's plan in hand. */
  openAt: Minutes;
  /** Events from here on arrive while the owner watches. */
  burstFrom: Minutes;
  /** Where the clock stands once everything has arrived. */
  decideAt: Minutes;
  doorsAt: Minutes;
  closeAt: Minutes;
  plan: {
    covers: number;
    sales: number;
    /** Scheduled wages for the whole team tonight, before any change. */
    wages: number;
    walkIns: number;
    peakWalkIns: number;
    tomorrowCovers: number;
    /** Projected cash at the end of the week before tonight's decisions. */
    weeklyCash: number;
    /** The owner's floor for weekly cash. */
    cashFloor: number;
    /** An upcoming order that could move to a later day if cash is tight. */
    deferrable?: { label: string; amount: number; to: string };
  };
  items: Partial<Record<ItemId, ItemSpec>>;
  /** Whether the on-call person says yes when asked. */
  onCallAccepts: boolean;
  /** The manager's reason when they overrule a staffing change (fault: manager_rejects). */
  managerObjection: string;
  events: TwinEvent[];
}

/* ------------------------------------------------------------------ */
/* Readings and reconciliation                                         */
/* ------------------------------------------------------------------ */

export interface Reading<T> {
  value: T;
  at: Minutes;
  eventId: string;
  source: SourceId;
  basis: Basis;
  freshness: Freshness;
}

export interface ReconcileReport {
  /** Distinct facts in hand that are current. */
  verified: { claim: string; eventId: string }[];
  stale: { source: SourceId; claim: string; ageMin: number }[];
  duplicates: { kept: string; ignored: string; reason: string }[];
  conflicts: { claim: string; a: Reading<number>; b: Reading<number>; resolvedBy: "book" | "host" | null }[];
  missing: { claim: string; why: string }[];
  unverified: { claim: string; eventId: string }[];
}

export interface SourceHealth {
  source: SourceId;
  last: Minutes | null;
  ageMin: number | null;
  freshness: Freshness;
}

/* ------------------------------------------------------------------ */
/* The twin                                                            */
/* ------------------------------------------------------------------ */

export interface InventoryLine {
  item: ItemId;
  name: string;
  line: Reading<number> | null;
  /** Null means nobody has counted the backup today. Unknown is not zero. */
  backup: Reading<number> | null;
  /** What receiving records say should be on hand. */
  expected: number | null;
  forecast: number | null;
  /** Portions short tonight with what is known. Null when it cannot be computed. */
  exposure: number | null;
  runOutAt: Minutes | null;
  status: "ok" | "short" | "needs_backup_count" | "needs_count" | "discrepancy" | "surplus" | "blocked" | "not_due";
}

export interface InvoiceView {
  key: string;
  vendor: string;
  number: string;
  total: number;
  contractTotal: number;
  previousAvg: number;
  priceEffect: number;
  volumeEffect: number;
  deltaPct: number;
  verdict: "price" | "volume" | "both" | "in_line";
  lines: { item: string; qty: number; usualQty: number; unitPrice: number; contractPrice: number }[];
  eventId: string;
  duplicatesSuppressed: number;
}

export interface PoLine {
  item: ItemId;
  name: string;
  qty: number;
  unitCost: number;
  why: string;
}

export type PoStatus = "none" | "draft" | "approved" | "unknown" | "confirmed";

export interface CashLine {
  label: string;
  amount: number;
  /** Estimated lines are shown, never added to the projection. */
  status: "proposed" | "approved" | "realized" | "estimated";
  decision: string | null;
}

export interface Twin {
  scenario: ScenarioId;
  clock: Minutes;
  demand: {
    planCovers: number;
    booked: Reading<number> | null;
    /** A second count that disagrees with the first, until someone resolves it. */
    disputed: Reading<number> | null;
    peakCovers: number | null;
    totalCovers: number | null;
    vsPlanPct: number | null;
    nearbyEvent: Reading<{ name: string; endsAt: Minutes; distanceMi: number; extraWalkIns: number }> | null;
  };
  staffing: {
    scheduled: Shift[];
    calledOut: Shift[];
    calloutRefs: { shiftId: string; eventId: string; at: Minutes }[];
    added: Shift[];
    cut: Shift[];
    servers: number;
    onCall: { id: string; name: string } | null;
    peakLoad: number | null;
    loadWithOneMore: number | null;
    loadWithOneLess: number | null;
    ceiling: number;
    floor: number;
  };
  sales: Reading<{ soFar: number; planSoFar: number }> | null;
  labor: {
    wages: number;
    projectedSales: number | null;
    pct: number | null;
    goalPct: number;
  };
  inventory: InventoryLine[];
  deliveries: { vendor: string; item: ItemId; name: string; ordered: number; received: number; short: number; unitCost: number; portionsPerUnit: number; eventId: string }[];
  purchasing: { lines: PoLine[]; total: number; status: PoStatus; orders: string[] };
  invoices: InvoiceView[];
  cash: { baseline: number; floor: number; lines: CashLine[]; projected: number; proposedDelta: number; withEstimates: number };
  health: SourceHealth[];
  ledger: ReconcileReport;
}

/* ------------------------------------------------------------------ */
/* Specialists and decisions                                           */
/* ------------------------------------------------------------------ */

export type SpecialistId = "demand" | "labor" | "supply" | "finance" | "risk" | "memory";

export interface Observation {
  specialist: SpecialistId;
  text: string;
  /** Events the observation stands on. */
  refs: string[];
  /** Whether it feeds a decision, or is only shown. */
  counted: boolean;
}

export type DecisionKey = string;
export type Lane = "now" | "missing_fact" | "can_wait";
export type Autonomy = "observe" | "recommend" | "prepare" | "execute";

export type DecisionStatus =
  | "recommend" // Savy stands behind a recommendation a person can approve
  | "held" // the risk is real, the recommendation is withheld until evidence returns
  | "conflict" // two sources disagree and the answer depends on which is right
  | "needs_fact" // one fact from the floor would settle it
  | "watching" // named, not acted on
  | "deferred" // can wait for a calmer moment
  | "resolved" // closed by evidence, nobody had to act
  | "approved"
  | "rejected";

export type Remedy =
  | { kind: "recheck_pos"; label: string }
  | { kind: "resolve_covers"; label: string }
  | { kind: "ask_manager"; item: ItemId; place: "line" | "backup"; label: string }
  | { kind: "submit_po"; label: string };

export interface Effect {
  label: string;
  from: string;
  to: string;
  basis: Basis;
}

export interface EvidenceRef {
  eventId: string;
  source: SourceId;
  label: string;
  value: string;
  basis: Basis;
  freshness: Freshness;
  at: Minutes | null;
}

export interface Decision {
  key: DecisionKey;
  id: string;
  domain: "labor" | "inventory" | "purchasing" | "finance" | "supply" | "watch";
  lane: Lane;
  status: DecisionStatus;
  title: string;
  headline: string;
  whatChanged: string[];
  whyItMatters: string;
  recommendation: { action: string; detail: string; approvable: boolean } | null;
  stillUnknown: string[];
  wouldChangeMind: string[];
  authority: { role: "Owner" | "GM" | "Chef"; why: string };
  autonomy: Autonomy;
  permissions: { can: string[]; cannot: string[] };
  guard: { requiresApproval: boolean; evidenceSufficient: boolean; externalActionAllowed: false; rules: string[] };
  doNothing: string;
  effects: Effect[];
  evidence: EvidenceRef[];
  confidence: { level: ConfidenceLevel; reasons: string[] };
  urgency: { by: Minutes | null; label: string };
  remedies: Remedy[];
  explain: { owner: string; gm: string; engineering: string[] };
}

/* ------------------------------------------------------------------ */
/* People, the record, and the end of the night                        */
/* ------------------------------------------------------------------ */

export type RejectReason = "floor_can_cover" | "not_worth_cost" | "know_something" | "too_late";
/** Why a recommendation was set aside, including the manager overruling one. */
export type TeachReason = RejectReason | "manager_overruled";

export type HumanAct =
  | { kind: "approved"; at: Minutes; version: number; action: string }
  | { kind: "rejected"; at: Minutes; version: number; reason: RejectReason; by: "owner" }
  | { kind: "rejected"; at: Minutes; version: number; reason: "manager_overruled"; by: "manager" };

export type Actor = "savy" | "system" | "owner" | "manager" | "vendor";

export interface AuditEntry {
  id: string;
  at: Minutes;
  actor: Actor;
  type: string;
  label: string;
  decision?: DecisionKey;
}

/** One entry in a decision's own history: v1, v2, v3. */
export interface DecisionVersion {
  version: number;
  at: Minutes;
  status: DecisionStatus;
  summary: string;
  cause: string;
}

export interface Receipt {
  id: string;
  decision: DecisionKey;
  decisionId: string;
  version: number;
  at: Minutes;
  known: string[];
  unknown: string[];
  recommended: string;
  chosen: string;
  approver: string;
  followed: string[];
  outcome: string | null;
}

export interface ManagerRequest {
  item: ItemId;
  place: "line" | "backup";
  askedAt: Minutes;
  answeredAt: Minutes | null;
  value: number | null;
}

export interface VendorSubmission {
  orderId: string;
  attempts: number;
  status: "submitting" | "unknown" | "reconciling" | "confirmed" | "found";
  log: { at: Minutes; text: string }[];
}

export interface NightPoint {
  at: Minutes;
  covers: number;
  /** Guests who tried to sit in this half hour, as an hourly rate. Unrounded, so the floor and the run agree. */
  hourly: number;
  servers: number;
  load: number;
  ticketMinutes: number;
  itemsLeft: Partial<Record<ItemId, number>>;
  sales: number;
  /** Walk-ins who left in this half hour because the floor was over its ceiling. */
  lost: number;
  alerts: string[];
}

export interface NightRun {
  branch: "nothing" | "plan" | "chosen";
  label: string;
  points: NightPoint[];
  totals: {
    covers: number;
    sales: number;
    wages: number;
    laborPct: number;
    peakLoad: number;
    worstTicket: number;
    walkAways: number;
    soldOut: { item: ItemId; name: string; at: Minutes }[];
    peakAlerts: number;
  };
  actions: string[];
}

export interface Outcome {
  closedAt: Minutes;
  expected: { sales: number | null; laborPct: number | null; peakLoad: number | null };
  actual: NightRun;
  lessons: string[];
}

import type { Minutes } from "@/domain/clock";
import { VENUE } from "@/domain/venue";
import { chosenChoices, simulate, summaryOf } from "./consequence";
import { clock, lowerFirst, usd } from "./format";
import { FAULT_ORDER, FAULTS, knowableAt, timelineOf } from "./ledger";
import { plan, type Plan } from "./plan";
import { SCENARIO_ORDER, SCENARIOS } from "./scenarios";
import { understand } from "./twin";
import type {
  Actor,
  AuditEntry,
  Decision,
  DecisionKey,
  DecisionVersion,
  EventOf,
  FaultId,
  HumanAct,
  ItemId,
  ManagerRequest,
  Outcome,
  PoStatus,
  Receipt,
  RejectReason,
  Scenario,
  ScenarioId,
  TeachReason,
  TwinEvent,
  VendorSubmission,
} from "./types";

/*
 * The runtime. State is a fold of actions through one reducer. Every screen,
 * Savy's answers, the stress lab and a shared link all rebuild the same night
 * by replaying the same actions.
 */

export type Phase = "idle" | "arriving" | "waiting" | "processing" | "live" | "closed" | "remembered";

export interface TwinState {
  scenario: ScenarioId;
  phase: Phase;
  clock: Minutes;
  /** Savy has processed everything that arrived up to this time. */
  processedThrough: Minutes;
  faults: FaultId[];
  /** Events people caused from the screen: counts, re-checks, vendor answers. */
  caused: TwinEvent[];
  resolution: "book" | "host" | null;
  human: Partial<Record<DecisionKey, HumanAct>>;
  requests: ManagerRequest[];
  submission: VendorSubmission | null;
  po: "approved" | "unknown" | "confirmed" | null;
  /** The order lines as they stood when the owner approved them. An approval is for those lines only. */
  poApprovedLines: string | null;
  /** A rejection waiting for the owner to say whether it's a one-off. */
  pendingTeach: { key: DecisionKey; reason: TeachReason } | null;
  taught: { key: DecisionKey; reason: TeachReason }[];
  audit: AuditEntry[];
  versions: Record<DecisionKey, DecisionVersion[]>;
  receipts: Receipt[];
  outcome: Outcome | null;
  seq: number;
  /** Events a what-if fork leaves out. Never set on the live night. */
  dropped?: string[];
}

export type TwinAction =
  | { type: "RESET" }
  | { type: "OPEN"; scenario: ScenarioId }
  | { type: "TICK" }
  | { type: "SKIP" }
  | { type: "RUN_SAVY" }
  | { type: "TOGGLE_FAULT"; fault: FaultId }
  | { type: "APPROVE"; key: DecisionKey }
  | { type: "REJECT"; key: DecisionKey; reason: RejectReason }
  | { type: "TEACH"; remember: boolean }
  | { type: "ASK_MANAGER"; item: ItemId; place: "line" | "backup" }
  | { type: "MANAGER_REPLY"; item: ItemId }
  | { type: "RECHECK_POS" }
  | { type: "RESOLVE_COVERS"; via: "book" | "host" }
  | { type: "SUBMIT_PO" }
  | { type: "VENDOR_RECONCILE" }
  | { type: "FAST_FORWARD" }
  | { type: "RECORD_MEMORY" };

export const initialTwin: TwinState = {
  scenario: "friday_rush",
  phase: "idle",
  clock: SCENARIOS.friday_rush.openAt,
  processedThrough: SCENARIOS.friday_rush.openAt,
  faults: [],
  caused: [],
  resolution: null,
  human: {},
  requests: [],
  submission: null,
  po: null,
  poApprovedLines: null,
  pendingTeach: null,
  taught: [],
  audit: [],
  versions: {},
  receipts: [],
  outcome: null,
  seq: 0,
};

/* ------------------------------------------------------------------ */
/* Evaluation: everything derived from state, computed once per state   */
/* ------------------------------------------------------------------ */

export interface Evaluation extends Plan {
  scenario: Scenario;
  /** Tonight's events with faults applied, arrived or not. */
  timeline: TwinEvent[];
  arrived: TwinEvent[];
  processed: TwinEvent[];
}

const cache = new WeakMap<TwinState, Evaluation>();

export function evaluate(state: TwinState): Evaluation {
  const hit = cache.get(state);
  if (hit) return hit;
  const scenario = SCENARIOS[state.scenario];
  const dropped = new Set(state.dropped ?? []);
  const timeline = timelineOf(scenario, state.faults).filter((e) => !dropped.has(e.id));
  const arrived = [...knowableAt(timeline, state.clock), ...state.caused];
  const processed = [...knowableAt(timeline, state.processedThrough), ...state.caused].sort((a, b) => a.availableAt - b.availableAt);

  const staffAct = state.human.staffing;
  const approvedAction = staffAct?.kind === "approved" ? staffAct.action ?? "" : "";
  // Savy's picture is as of what it has processed. While it reads the afternoon, it reads it in order.
  const core = understand({
    scenario,
    clock: state.processedThrough,
    events: processed,
    resolution: state.resolution,
    staffing: {
      added: approvedAction.startsWith("Offer") && !approvedAction.includes("early out") && scenario.onCallAccepts,
      cut: approvedAction.includes("early out"),
    },
    po: { status: poStatusOf(state), orders: state.submission && state.submission.status !== "unknown" ? [state.submission.orderId] : [] },
  });
  const planned = plan({ twin: core, scenario, human: state.human, requests: state.requests });
  const out: Evaluation = { ...planned, scenario, timeline, arrived, processed };
  cache.set(state, out);
  return out;
}

function poStatusOf(state: TwinState): PoStatus {
  if (state.po === "confirmed") return "confirmed";
  if (state.po === "unknown") return "unknown";
  if (state.po === "approved") return "approved";
  return "draft";
}

export const decisionOf = (state: TwinState, key: DecisionKey) => evaluate(state).decisions.find((d) => d.key === key) ?? null;

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

type Draft = { actor: Actor; type: string; label: string; decision?: DecisionKey; at?: Minutes };

function record(state: TwinState, drafts: Draft[]): TwinState {
  if (drafts.length === 0) return state;
  let seq = state.seq;
  const entries: AuditEntry[] = drafts.map((d) => ({ id: `aud_${++seq}`, at: d.at ?? state.clock, actor: d.actor, type: d.type, label: d.label, decision: d.decision }));
  return { ...state, audit: [...state.audit, ...entries], seq };
}

const fingerprint = (d: Decision) => `${d.status}|${d.recommendation?.action ?? ""}|${d.headline}`;

/** How the decisions moved between two states: audit lines and new versions in each decision's ledger. */
function trackDecisions(before: TwinState, after: TwinState, cause: string): TwinState {
  if (after.phase === "idle" || after.phase === "arriving" || after.phase === "waiting") return after;
  const prev = before.phase === "processing" || before.phase === "live" || before.phase === "closed" || before.phase === "remembered" ? evaluate(before).decisions : [];
  const next = evaluate(after).decisions;
  const drafts: Draft[] = [];
  const versions = { ...after.versions };

  for (const d of next) {
    const old = prev.find((p) => p.key === d.key);
    const history = versions[d.key] ?? [];
    if (old && fingerprint(old) === fingerprint(d) && history.length > 0) continue;
    const version: DecisionVersion = {
      version: history.length + 1,
      at: after.clock,
      status: d.status,
      summary: d.recommendation ? d.recommendation.action : d.headline,
      cause,
    };
    versions[d.key] = [...history, version];
    if (d.status === "approved" || d.status === "rejected") continue; // the person's own line says it
    if (!old) drafts.push({ actor: "savy", type: "decision.drafted", label: `${d.title}: ${lowerFirst(version.summary).replace(/\.+$/, "")}.`, decision: d.key });
    else if (old.status === "recommend" && (d.status === "held" || d.status === "conflict" || d.status === "needs_fact")) {
      drafts.push({ actor: "savy", type: "recommendation.withdrawn", label: `Recommendation withdrawn. ${d.recommendation?.action ?? d.headline}`, decision: d.key });
    } else if (d.status === "recommend" && (old.status === "held" || old.status === "conflict")) {
      drafts.push({ actor: "savy", type: "recommendation.restored", label: `Recommendation restored: ${d.recommendation?.action}.`, decision: d.key });
    } else if (d.status === "resolved") {
      drafts.push({ actor: "savy", type: "decision.resolved", label: `Closed by evidence: ${lowerFirst(d.headline)}`, decision: d.key });
    } else {
      drafts.push({ actor: "savy", type: "decision.changed", label: `${d.title}: ${lowerFirst(version.summary).replace(/\.+$/, "")}.`, decision: d.key });
    }
  }
  for (const old of prev) {
    if (!next.some((d) => d.key === old.key)) {
      drafts.push({ actor: "savy", type: "decision.closed", label: `No longer needed: ${lowerFirst(old.title)}.`, decision: old.key });
      versions[old.key] = [...(versions[old.key] ?? []), { version: (versions[old.key]?.length ?? 0) + 1, at: after.clock, status: "resolved", summary: "No longer needed", cause }];
    }
  }
  return record({ ...after, versions }, drafts);
}

function receiptFor(state: TwinState, d: Decision, chosen: string, followed: string[]): Receipt {
  return {
    id: `RCT-${String(state.receipts.length + 1).padStart(3, "0")}`,
    decision: d.key,
    decisionId: d.id,
    version: state.versions[d.key]?.length ?? 1,
    at: state.clock,
    known: d.evidence.map((e) => `${e.label}: ${e.value} (${e.basis}${e.freshness !== "fresh" ? `, ${e.freshness}` : ""})`),
    unknown: d.stillUnknown,
    recommended: d.recommendation?.action ?? d.headline,
    chosen,
    approver: `Owner (${VENUE.owner})`,
    followed,
    outcome: null,
  };
}

/** A person can approve a recommendation Savy stands behind, or a flag for later. */
export const APPROVABLE = new Set<Decision["status"]>(["recommend", "deferred"]);

const REJECT_LABEL: Record<RejectReason, string> = {
  floor_can_cover: "the floor can cover it",
  not_worth_cost: "not worth the cost tonight",
  know_something: "the owner knows something the systems don't",
  too_late: "too late to change",
};
export const REJECT_REASONS: { id: RejectReason; label: string }[] = (Object.keys(REJECT_LABEL) as RejectReason[]).map((id) => ({ id, label: REJECT_LABEL[id] }));

/* ------------------------------------------------------------------ */
/* The reducer                                                         */
/* ------------------------------------------------------------------ */

const nextReal = (events: TwinEvent[], after: Minutes, until: Minutes = Infinity) =>
  events.find((e) => e.availableAt > after && e.availableAt <= until && !e.routine)?.availableAt ?? null;

/** A night starts clean: faults, decisions and the record all belong to the night they happened on. */
function open(scenario: ScenarioId): TwinState {
  const s = SCENARIOS[scenario];
  return record({ ...initialTwin, scenario, phase: "arriving", clock: s.openAt, processedThrough: s.openAt }, [
    { actor: "system", type: "plan.loaded", label: `${s.service} plan loaded: ${s.plan.covers} covers, ${usd(s.plan.sales)} in sales.` },
  ]);
}

function cause(action: TwinAction): string {
  switch (action.type) {
    case "TOGGLE_FAULT":
      return `fault ${action.fault}`;
    case "APPROVE":
    case "REJECT":
      return `${action.type.toLowerCase()} ${action.key}`;
    case "MANAGER_REPLY":
      return `manager count: ${action.item}`;
    case "RECHECK_POS":
      return "POS re-check";
    case "RESOLVE_COVERS":
      return `covers settled by the ${action.via}`;
    default:
      return action.type.toLowerCase();
  }
}

export function twinReducer(state: TwinState, action: TwinAction): TwinState {
  const next = step(state, action);
  if (next === state) return state;
  return trackDecisions(state, withdrawStaleOrder(next), causeFor(state, next, action));
}

const linesKey = (lines: readonly { name: string; qty: number }[]) => lines.map((l) => `${l.name} ${l.qty > 0 ? "+" : "−"}${Math.abs(l.qty)}`).join(", ");

/**
 * An approval covers the order as it stood when it was approved. If a count
 * or a cover change moves the lines before the order is sent, the approval
 * no longer applies: the order goes back to draft and asks again.
 */
function withdrawStaleOrder(state: TwinState): TwinState {
  if (state.po !== "approved" || state.submission || state.poApprovedLines === null) return state;
  const now = linesKey(evaluate(state).twin.purchasing.lines);
  if (now === state.poApprovedLines) return state;
  const human = Object.fromEntries(Object.entries(state.human).filter(([key]) => key !== "purchasing"));
  const was = state.poApprovedLines;
  return record(
    {
      ...state,
      po: null,
      poApprovedLines: null,
      human,
      receipts: state.receipts.map((r) =>
        r.decision === "purchasing" && r.outcome === null && r.chosen === "Approved as drafted"
          ? { ...r, chosen: "Approved, then withdrawn before it was sent", followed: [...r.followed, `The order changed from ${was} to ${now || "nothing"}. Not sent.`] }
          : r,
      ),
    },
    [{ actor: "savy", type: "order.approval_withdrawn", label: `Tomorrow's order changed after you approved it (${was} → ${now || "nothing"}). It needs your approval again.`, decision: "purchasing" }],
  );
}

function causeFor(before: TwinState, after: TwinState, action: TwinAction): string {
  if (action.type === "TICK" && after.processedThrough > before.processedThrough) {
    const e = evaluate(after).timeline.filter((x) => x.availableAt > before.processedThrough && x.availableAt <= after.processedThrough && !x.routine).at(-1);
    return e ? `${e.kind} @ ${clock(e.availableAt)}` : "tick";
  }
  return cause(action);
}

function step(state: TwinState, action: TwinAction): TwinState {
  const s = SCENARIOS[state.scenario];

  switch (action.type) {
    case "RESET":
      return initialTwin;

    case "OPEN":
      return open(action.scenario);

    case "TICK": {
      const timeline = evaluate(state).timeline;
      if (state.phase === "arriving") {
        const at = nextReal(timeline, state.clock, s.decideAt);
        if (at === null) return record({ ...state, clock: s.decideAt, phase: "waiting" }, [arrivedLine(state, s)]);
        return { ...state, clock: at };
      }
      if (state.phase === "processing") {
        const at = nextReal(timeline, state.processedThrough, state.clock);
        if (at === null) return finishProcessing({ ...state, processedThrough: state.clock });
        return { ...state, processedThrough: at };
      }
      return state;
    }

    case "SKIP":
      if (state.phase === "arriving") return record({ ...state, clock: s.decideAt, phase: "waiting" }, [arrivedLine(state, s)]);
      if (state.phase === "processing") return finishProcessing({ ...state, processedThrough: state.clock });
      return state;

    case "RUN_SAVY": {
      const ready = state.phase === "arriving" ? { ...state, clock: s.decideAt } : state;
      if (ready.phase !== "waiting" && ready.phase !== "arriving") return state;
      return record({ ...ready, phase: "processing" }, [{ actor: "owner", type: "savy.run", label: "Savy asked to read what arrived." }]);
    }

    case "TOGGLE_FAULT": {
      // Faults test a night that is still open. A closed night is on the record.
      if (state.phase === "idle" || state.phase === "closed" || state.phase === "remembered") return state;
      const on = state.faults.includes(action.fault);
      const faults = on ? state.faults.filter((f) => f !== action.fault) : [...state.faults, action.fault];
      const reset = action.fault === "reservations_disagree" && on ? { resolution: null } : {};
      return record({ ...state, faults, ...reset }, [
        { actor: "system", type: on ? "fault.cleared" : "fault.injected", label: `${on ? "Restored" : "Pressure test"}: ${FAULTS[action.fault].label.toLowerCase()}.` },
      ]);
    }

    case "APPROVE": {
      if (state.phase !== "live") return state;
      const d = decisionOf(state, action.key);
      if (!d || !APPROVABLE.has(d.status) || !d.recommendation?.approvable) return state;
      const act: HumanAct = { kind: "approved", at: state.clock, version: state.versions[d.key]?.length ?? 1, action: d.recommendation.action };
      let followed: string[] = [];
      if (d.key === "staffing") {
        followed = d.recommendation.action.includes("early out")
          ? [`Schedule draft updated: ${d.recommendation.action.replace("Offer ", "")} (not published)`, "Message prepared for the manager to send"]
          : [`Schedule draft updated: ${d.recommendation.action.replace(/^Offer /, "").replace(/, on call$/, "")} (not published)`, "Message prepared for the manager to send"];
      } else if (d.key === "purchasing") followed = ["Order approved. Waiting for the owner to submit it to the vendor."];
      else if (d.key.startsWith("supply:")) followed = ["Credit request drafted for the vendor. Not sent.", "Line told the cap at lineup (manager)"];
      else if (d.key.startsWith("invoice:")) followed = ["Flagged for Monday's review"];
      else if (d.key === "cash") followed = ["Order moved in the plan. The vendor isn't told until the owner tells them."];

      let next: TwinState = { ...state, human: { ...state.human, [d.key]: act }, receipts: [...state.receipts, receiptFor(state, d, "Approved as drafted", followed)] };
      if (d.key === "purchasing") next = { ...next, po: "approved", poApprovedLines: linesKey(evaluate(state).twin.purchasing.lines) };
      next = record(next, [{ actor: "owner", type: "decision.approved", label: `The owner approved: ${lowerFirst(d.recommendation.action)}.`, decision: d.key }]);

      // The manager can overrule a staffing change. Savy records it and does not argue.
      if (d.key === "staffing" && state.faults.includes("manager_rejects")) {
        const overruled: HumanAct = { kind: "rejected", at: state.clock + 2, version: act.version, reason: "manager_overruled", by: "manager" };
        next = {
          ...next,
          clock: state.clock + 2,
          processedThrough: state.clock + 2,
          human: { ...next.human, staffing: overruled },
          pendingTeach: { key: "staffing", reason: "manager_overruled" },
          receipts: next.receipts.map((r, i) => (i === next.receipts.length - 1 ? { ...r, chosen: "Approved by the owner, then overruled by the manager", followed: ["Schedule left unchanged"] } : r)),
        };
        next = record(next, [
          { actor: "manager", type: "decision.overruled", label: `The manager overruled it: "${s.managerObjection}"`, decision: "staffing" },
          { actor: "savy", type: "disagreement.recorded", label: "Disagreement recorded. Savy will compare the outcome at close.", decision: "staffing" },
        ]);
      }
      return next;
    }

    case "REJECT": {
      if (state.phase !== "live") return state;
      const d = decisionOf(state, action.key);
      if (!d || !APPROVABLE.has(d.status) || !d.recommendation) return state;
      const act: HumanAct = { kind: "rejected", at: state.clock, version: state.versions[d.key]?.length ?? 1, reason: action.reason, by: "owner" };
      return record(
        {
          ...state,
          human: { ...state.human, [d.key]: act },
          pendingTeach: { key: d.key, reason: action.reason },
          receipts: [...state.receipts, receiptFor(state, d, `Rejected: ${REJECT_LABEL[action.reason]}`, ["Nothing changed"])],
        },
        [{ actor: "owner", type: "decision.rejected", label: `The owner set it aside: ${REJECT_LABEL[action.reason]}.`, decision: d.key }],
      );
    }

    case "TEACH": {
      const pending = state.pendingTeach;
      if (!pending) return state;
      return record(
        { ...state, pendingTeach: null, taught: action.remember ? [...state.taught, pending] : state.taught },
        [
          action.remember
            ? { actor: "owner", type: "memory.taught", label: "The owner asked Savy to remember this. It stays a candidate until more nights agree.", decision: pending.key }
            : { actor: "owner", type: "memory.one_off", label: "Just tonight. Savy won't generalise from it.", decision: pending.key },
        ],
      );
    }

    case "ASK_MANAGER": {
      if (state.phase !== "live") return state;
      if (state.requests.some((r) => r.item === action.item && r.answeredAt === null)) return state;
      // A person is only asked for a count a decision is actually waiting on.
      const wanted = evaluate(state).decisions.some((d) => d.remedies.some((r) => r.kind === "ask_manager" && r.item === action.item && r.place === action.place));
      if (!wanted) return state;
      const name = s.items[action.item]?.name.toLowerCase() ?? action.item;
      return record({ ...state, requests: [...state.requests, { item: action.item, place: action.place, askedAt: state.clock, answeredAt: null, value: null }] }, [
        { actor: "owner", type: "manager.asked", label: `Asked the manager for a ${action.place === "backup" ? "walk-in" : "line"} count of ${name}.` },
      ]);
    }

    case "MANAGER_REPLY": {
      if (state.phase !== "live") return state;
      const req = state.requests.find((r) => r.item === action.item && r.answeredAt === null);
      const spec = s.items[action.item];
      if (!req || !spec) return state;
      const at = state.clock + 4;
      const value = req.place === "backup" ? spec.truth.backup : spec.truth.line;
      const event: EventOf<"inventory.count"> = {
        id: `evt_mgr_${String(state.caused.length + 1).padStart(3, "0")}`,
        kind: "inventory.count",
        source: "staff",
        occurredAt: at,
        availableAt: at,
        dedupeKey: `mgr:${action.item}:${req.place}:${at}`,
        routine: false,
        summary: `Manager: ${value} ${spec.name.toLowerCase()} ${req.place === "backup" ? "in the walk-in" : "on the line"}.`,
        cause: "manager request",
        payload: { item: action.item, place: req.place, onHand: value, reportedBy: "manager" },
      };
      return record(
        {
          ...state,
          clock: at,
          processedThrough: at,
          caused: [...state.caused, event],
          requests: state.requests.map((r) => (r === req ? { ...r, answeredAt: at, value } : r)),
        },
        [{ actor: "manager", type: "inventory.count.reported", label: event.summary, at }],
      );
    }

    case "RECHECK_POS": {
      // Only when a decision is waiting on current sales; otherwise there is nothing to re-check.
      if (state.phase !== "live" || !evaluate(state).decisions.some((d) => d.remedies.some((r) => r.kind === "recheck_pos"))) return state;
      const at = state.clock + 1;
      const real = [...s.events].reverse().find((e): e is EventOf<"sales.updated"> => e.kind === "sales.updated" && e.availableAt <= state.clock);
      if (!real) return state;
      const event: EventOf<"sales.updated"> = { ...real, id: `evt_pos_recheck_${state.caused.length + 1}`, availableAt: at, occurredAt: at, dedupeKey: `pos:recheck:${at}`, routine: false, cause: "owner re-check", summary: `POS answered a re-check: ${usd(real.payload.soFar)} since open.` };
      return record({ ...state, clock: at, processedThrough: at, caused: [...state.caused, event] }, [{ actor: "owner", type: "pos.recheck", label: "Sales re-check requested. The POS answered.", at }]);
    }

    case "RESOLVE_COVERS": {
      if (state.phase !== "live" || !state.faults.includes("reservations_disagree") || state.resolution) return state;
      return record({ ...state, resolution: action.via }, [
        { actor: "owner", type: "evidence.conflict_resolved", label: `The owner confirmed the ${action.via === "book" ? "reservation book" : "host stand"} count.` },
      ]);
    }

    case "SUBMIT_PO": {
      if (state.phase !== "live" || state.po !== "approved" || state.submission) return state;
      // Only the order the owner approved, and only while it still exists.
      const order = evaluate(state);
      if (order.decisions.find((d) => d.key === "purchasing")?.status !== "approved" || order.twin.purchasing.lines.length === 0) return state;
      const orderId = `PO-${state.scenario === "friday_rush" ? "1002" : state.scenario === "supplier_problem" ? "1001" : "0929"}-01`;
      const timeout = state.faults.includes("vendor_timeout");
      const log = [{ at: state.clock, text: `Owner submitted ${orderId}.` }];
      if (timeout) {
        log.push({ at: state.clock, text: "The vendor didn't answer within 30 seconds. Status unknown." });
        log.push({ at: state.clock, text: "Not retrying: a blind retry could create a second order." });
      } else log.push({ at: state.clock, text: "The vendor confirmed the order." });
      const next: TwinState = { ...state, po: timeout ? "unknown" : "confirmed", submission: { orderId, attempts: 1, status: timeout ? "unknown" : "confirmed", log } };
      return record(withReceiptFollow(next, "purchasing", timeout ? `Submitted ${orderId}. Vendor status unknown.` : `Submitted ${orderId}. Confirmed by the vendor.`), [
        { actor: "owner", type: "po.submitted", label: `The owner submitted ${orderId}.` },
        timeout
          ? { actor: "vendor", type: "po.status_unknown", label: "Submission status unknown. Savy will not retry blindly; reconciling with the vendor first." }
          : { actor: "vendor", type: "po.confirmed", label: `${orderId} confirmed.` },
      ]);
    }

    case "VENDOR_RECONCILE": {
      // Only while the night is open. Closing the night reconciles first, so a closed night never changes.
      if (state.phase !== "live") return state;
      const sub = state.submission;
      if (!sub || sub.status !== "unknown") return state;
      const at = state.clock + 1;
      const done: VendorSubmission = {
        ...sub,
        status: "found",
        log: [...sub.log, { at, text: `Checked the vendor's open orders for ${sub.orderId}.` }, { at, text: "Existing order found. No second order created." }],
      };
      return record(withReceiptFollow({ ...state, clock: at, po: "confirmed", submission: done }, "purchasing", "Reconciled: existing order found, no second order."), [
        { actor: "savy", type: "po.reconciled", label: `Existing order ${sub.orderId} found. No second order created.`, at },
      ]);
    }

    case "FAST_FORWARD": {
      if (state.phase !== "live") return state;
      if (state.submission?.status === "unknown") return step(step(state, { type: "VENDOR_RECONCILE" }), action);
      const e = evaluate(state);
      const actual = simulate(s, e.twin, chosenChoices(e.twin, e.decisions), "chosen", "What happened");
      if (!actual) return state;
      const outcome: Outcome = {
        closedAt: s.closeAt,
        expected: { sales: e.twin.labor.projectedSales, laborPct: e.twin.labor.pct, peakLoad: e.twin.staffing.peakLoad },
        actual,
        lessons: lessonsOf(state, actual),
      };
      const receipts = state.receipts.map((r) => ({ ...r, outcome: summaryOf(actual) }));
      // The decisions stay as they were made. Only the clock moves to close.
      return record({ ...state, phase: "closed", clock: s.closeAt, outcome, receipts }, [
        { actor: "system", type: "outcome.recorded", label: `Service closed. ${summaryOf(actual)}` },
      ]);
    }

    case "RECORD_MEMORY":
      if (state.phase !== "closed") return state;
      return record({ ...state, phase: "remembered" }, [{ actor: "savy", type: "memory.recorded", label: "Tonight's decisions and outcome were added to decision memory." }]);
  }
}

function arrivedLine(state: TwinState, s: Scenario): Draft {
  const count = evaluate(state).timeline.filter((e) => e.availableAt >= s.burstFrom && e.availableAt <= s.decideAt && !e.routine).length;
  return { actor: "system", type: "signals.waiting", label: `${count} new signals since ${clock(s.openAt)}. Savy hasn't read them yet.`, at: s.decideAt };
}

function finishProcessing(state: TwinState): TwinState {
  const e = evaluate({ ...state, phase: "live" });
  const needs = e.decisions.filter((d) => d.lane !== "can_wait").length;
  return record({ ...state, phase: "live" }, [
    { actor: "savy", type: "plan.synthesized", label: `Read ${e.processed.length} signals. ${needs} decisions need a person; ${e.decisions.length - needs} can wait.` },
  ]);
}

function withReceiptFollow(state: TwinState, key: DecisionKey, line: string): TwinState {
  return { ...state, receipts: state.receipts.map((r) => (r.decision === key ? { ...r, followed: [...r.followed, line] } : r)) };
}

function lessonsOf(state: TwinState, run: NonNullable<Outcome["actual"]>): string[] {
  const out: string[] = [];
  const staff = state.human.staffing;
  if (staff?.kind === "approved") {
    out.push(
      staff.action.includes("early out")
        ? `${staff.action.replace(/^Offer /, "").replace(/ an early out at .*$/, "")} left early; the floor peaked at ${run.totals.peakLoad.toFixed(1)} covers per server.`
        : `The added shift held the floor at ${run.totals.peakLoad.toFixed(1)} covers per server.`,
    );
  }
  if (staff?.kind === "rejected" && staff.by === "manager") out.push(`The manager's call: no added server. Peak ran at ${run.totals.peakLoad.toFixed(1)}, tickets ${run.totals.worstTicket} min at worst.`);
  for (const x of run.totals.soldOut) out.push(`${x.name} sold out at ${clock(x.at)}.`);
  if (out.length === 0) out.push(summaryOf(run));
  return out;
}

/* ------------------------------------------------------------------ */
/* Sessions: an action log as a short, readable link                    */
/* ------------------------------------------------------------------ */

export const MAX_ACTIONS = 600;
const ITEMS: ItemId[] = ["burrata", "branzino", "greens"];

function keyCode(key: DecisionKey): string {
  if (key === "staffing") return "S";
  if (key === "purchasing") return "P";
  if (key === "event") return "E";
  if (key === "cash") return "C";
  const [kind, rest = ""] = key.split(":");
  if (kind === "inventory") return `I${ITEMS.indexOf(rest as ItemId)}`;
  if (kind === "supply") return `U${ITEMS.indexOf(rest as ItemId)}`;
  if (kind === "invoice") return `N${rest}`;
  return "";
}

function keyOf(code: string): DecisionKey | null {
  const head = code[0];
  const rest = code.slice(1);
  switch (head) {
    case "S":
      return "staffing";
    case "P":
      return "purchasing";
    case "E":
      return "event";
    case "C":
      return "cash";
    case "I":
      return ITEMS[Number(rest)] ? `inventory:${ITEMS[Number(rest)]}` : null;
    case "U":
      return ITEMS[Number(rest)] ? `supply:${ITEMS[Number(rest)]}` : null;
    case "N":
      return /^[A-Z]{2}-\d{3,6}$/.test(rest) ? `invoice:${rest}` : null;
    default:
      return null;
  }
}

const REASONS = REJECT_REASONS.map((r) => r.id);

function tokenOf(a: TwinAction): string {
  switch (a.type) {
    case "RESET":
      return "r";
    case "OPEN":
      return `o${SCENARIO_ORDER.indexOf(a.scenario)}`;
    case "TICK":
      return "t";
    case "SKIP":
      return "s";
    case "RUN_SAVY":
      return "g";
    case "TOGGLE_FAULT":
      return `f${FAULT_ORDER.indexOf(a.fault)}`;
    case "APPROVE":
      return `a${keyCode(a.key)}`;
    case "REJECT":
      return `x${REASONS.indexOf(a.reason)}${keyCode(a.key)}`;
    case "TEACH":
      return a.remember ? "m1" : "m0";
    case "ASK_MANAGER":
      return `k${ITEMS.indexOf(a.item)}${a.place === "backup" ? "b" : "l"}`;
    case "MANAGER_REPLY":
      return `y${ITEMS.indexOf(a.item)}`;
    case "RECHECK_POS":
      return "p";
    case "RESOLVE_COVERS":
      return a.via === "book" ? "vb" : "vh";
    case "SUBMIT_PO":
      return "u";
    case "VENDOR_RECONCILE":
      return "w";
    case "FAST_FORWARD":
      return "z";
    case "RECORD_MEMORY":
      return "q";
  }
}

export function parseToken(token: string): TwinAction | null {
  const head = token[0];
  const rest = token.slice(1);
  const n = Number(rest);
  switch (head) {
    case "r":
      return rest === "" ? { type: "RESET" } : null;
    case "o":
      return SCENARIO_ORDER[n] && rest !== "" ? { type: "OPEN", scenario: SCENARIO_ORDER[n]! } : null;
    case "t":
      return rest === "" ? { type: "TICK" } : null;
    case "s":
      return rest === "" ? { type: "SKIP" } : null;
    case "g":
      return rest === "" ? { type: "RUN_SAVY" } : null;
    case "f":
      return FAULT_ORDER[n] && rest !== "" ? { type: "TOGGLE_FAULT", fault: FAULT_ORDER[n]! } : null;
    case "a": {
      const key = keyOf(rest);
      return key ? { type: "APPROVE", key } : null;
    }
    case "x": {
      const reason = REASONS[Number(rest[0])];
      const key = keyOf(rest.slice(1));
      return reason && key ? { type: "REJECT", key, reason } : null;
    }
    case "m":
      return rest === "0" || rest === "1" ? { type: "TEACH", remember: rest === "1" } : null;
    case "k": {
      const item = ITEMS[Number(rest[0])];
      const place = rest[1] === "b" ? "backup" : rest[1] === "l" ? "line" : null;
      return item && place && rest.length === 2 ? { type: "ASK_MANAGER", item, place } : null;
    }
    case "y":
      return ITEMS[n] && rest !== "" ? { type: "MANAGER_REPLY", item: ITEMS[n]! } : null;
    case "p":
      return rest === "" ? { type: "RECHECK_POS" } : null;
    case "v":
      return rest === "b" ? { type: "RESOLVE_COVERS", via: "book" } : rest === "h" ? { type: "RESOLVE_COVERS", via: "host" } : null;
    case "u":
      return rest === "" ? { type: "SUBMIT_PO" } : null;
    case "w":
      return rest === "" ? { type: "VENDOR_RECONCILE" } : null;
    case "z":
      return rest === "" ? { type: "FAST_FORWARD" } : null;
    case "q":
      return rest === "" ? { type: "RECORD_MEMORY" } : null;
    default:
      return null;
  }
}

/** Runs of ticks are written as one token: `t12`. */
export function encodeSession(actions: readonly TwinAction[]): string {
  const out: string[] = [];
  let ticks = 0;
  const flush = () => {
    // Runs longer than the decoder accepts are written as several runs, so every link round-trips.
    while (ticks > 0) {
      const run = Math.min(ticks, TICK_RUN_MAX);
      out.push(run === 1 ? "t" : `t${run}`);
      ticks -= run;
    }
  };
  for (const a of actions) {
    if (a.type === "TICK") {
      ticks++;
      continue;
    }
    flush();
    out.push(tokenOf(a));
  }
  flush();
  return out.join(".");
}

const TICK_RUN_MAX = 200;

/**
 * Only the last night matters: OPEN and RESET both start from nothing, so
 * everything before the last of them can be dropped. Then the night itself is
 * capped, from its start.
 */
export function lastNight(actions: readonly TwinAction[]): TwinAction[] {
  const from = nightStart(actions);
  return actions.slice(from, from + MAX_ACTIONS);
}

function nightStart(actions: readonly TwinAction[]): number {
  let from = 0;
  actions.forEach((a, i) => {
    if (a.type === "OPEN") from = i;
    else if (a.type === "RESET") from = i + 1;
  });
  return from;
}

/** True when the last night is longer than a replay keeps, so replaying it would silently drop its end. */
export const nightTooLong = (actions: readonly TwinAction[]) => actions.length - nightStart(actions) > MAX_ACTIONS;

/** Unknown or malformed tokens are dropped, never guessed at. */
export function decodeSession(token: string): TwinAction[] {
  const out: TwinAction[] = [];
  for (const part of token.split(".")) {
    const run = /^t(\d{1,3})$/.exec(part);
    if (run) {
      for (let i = 0; i < Math.min(Number(run[1]), TICK_RUN_MAX); i++) out.push({ type: "TICK" });
      continue;
    }
    const a = parseToken(part);
    if (a) out.push(a);
  }
  return lastNight(out);
}

export const fold = (actions: readonly TwinAction[]) => actions.reduce(twinReducer, initialTwin);

/** Validates an untrusted action list (from a request body) and keeps its last night. */
export const parseActions = (raw: unknown): TwinAction[] => lastNight(validActions(raw));

/** Every action in an untrusted list that round-trips through its token. Anything else is dropped. */
export function validActions(raw: unknown): TwinAction[] {
  if (!Array.isArray(raw)) return [];
  const out: TwinAction[] = [];
  // The body is already size-capped by the route, so the whole list can be read before the last night is kept.
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    try {
      const token = tokenOf(item as TwinAction);
      const parsed = typeof token === "string" ? parseToken(token) : null;
      if (parsed) out.push(parsed);
    } catch {
      // Not an action this reducer knows. Dropped.
    }
  }
  return out;
}

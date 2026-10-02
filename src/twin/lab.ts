import { FAULT_ORDER, FAULTS } from "./ledger";
import { APPROVABLE, decodeSession, encodeSession, evaluate, fold, twinReducer, type TwinAction, type TwinState } from "./runtime";
import { SCENARIO_ORDER } from "./scenarios";
import type { Decision, FaultId, ScenarioId } from "./types";

/*
 * The stress lab. Every night, under every combination of the six faults,
 * runs through the real reducer and is held to the same promises. It runs in
 * the browser on a button and in the test suite on every change.
 */

export const COMBINATIONS = 1 << FAULT_ORDER.length;
export const RUN_COUNT = SCENARIO_ORDER.length * COMBINATIONS;

export interface LabCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LabRun {
  id: number;
  scenario: ScenarioId;
  faults: FaultId[];
  checks: LabCheck[];
  recommends: number;
  withholds: number;
  passed: boolean;
}

export const faultsOf = (mask: number): FaultId[] => FAULT_ORDER.filter((_, i) => mask & (1 << i));

const OPEN: TwinAction[] = [{ type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }];
const WITHHELD = new Set<Decision["status"]>(["held", "conflict", "needs_fact"]);

function opened(scenario: ScenarioId, faults: FaultId[]): { state: TwinState; actions: TwinAction[] } {
  const actions: TwinAction[] = [{ type: "OPEN", scenario }, ...faults.map((fault): TwinAction => ({ type: "TOGGLE_FAULT", fault })), ...OPEN];
  return { state: fold(actions), actions };
}

const run = (state: TwinState, actions: TwinAction[], ...more: TwinAction[]) => {
  let s = state;
  for (const a of more) {
    s = twinReducer(s, a);
    actions.push(a);
  }
  return s;
};

const BAD_FIGURE = /NaN|Infinity|undefined|\$-|null%/;

export function runLab(id: number): LabRun {
  const scenario = SCENARIO_ORDER[Math.floor(id / COMBINATIONS)]!;
  const faults = faultsOf(id % COMBINATIONS);
  const checks: LabCheck[] = [];
  const check = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

  const { state, actions } = opened(scenario, faults);
  const e = evaluate(state);
  check("Reads the night and reaches a plan", state.phase === "live", state.phase);

  const text = JSON.stringify({ twin: e.twin, decisions: e.decisions });
  const bad = BAD_FIGURE.exec(text);
  check("No figure is NaN, blank or negative money", !bad, bad ? `found "${bad[0]}"` : "");

  // Approval only lands where Savy stands behind the recommendation.
  let gate = true;
  for (const d of e.decisions) {
    const after = twinReducer(state, { type: "APPROVE", key: d.key });
    const shouldLand = APPROVABLE.has(d.status) && Boolean(d.recommendation?.approvable);
    if ((after !== state) !== shouldLand) gate = false;
  }
  check("Approve lands only on what Savy stands behind", gate);

  const stuck = e.decisions.filter((d) => WITHHELD.has(d.status) && d.remedies.length === 0);
  check("Every withheld decision offers a way forward", stuck.length === 0, stuck.map((d) => d.id).join(", "));

  const staleHighConfidence = e.decisions.filter((d) => d.confidence.level === "high" && d.evidence.some((x) => x.freshness !== "fresh"));
  check("No high confidence over stale evidence", staleHighConfidence.length === 0, staleHighConfidence.map((d) => d.id).join(", "));

  /* One promise per fault ------------------------------------------- */
  if (faults.includes("pos_delayed")) {
    const priced = e.decisions.filter((d) => d.domain === "labor" && d.status === "recommend");
    check(FAULTS.pos_delayed.promise, priced.length === 0 && e.twin.labor.pct === null, priced.map((d) => d.id).join(", "));
  }
  if (faults.includes("reservations_disagree")) {
    const dependent = e.decisions.filter((d) => (d.domain === "labor" || d.domain === "inventory") && d.status === "recommend");
    check(FAULTS.reservations_disagree.promise, dependent.length === 0 && e.twin.demand.peakCovers === null, dependent.map((d) => d.id).join(", "));
  }
  if (faults.includes("invoice_duplicated")) {
    const clean = evaluate(opened(scenario, faults.filter((f) => f !== "invoice_duplicated")).state);
    const same = clean.twin.purchasing.total === e.twin.purchasing.total && clean.twin.cash.projected === e.twin.cash.projected && clean.twin.invoices.length === e.twin.invoices.length;
    check(FAULTS.invoice_duplicated.promise, same && e.twin.ledger.duplicates.some((d) => d.reason.startsWith("Same vendor")), same ? "" : "totals moved");
  }
  if (faults.includes("inventory_missing")) {
    const invented = e.twin.inventory.filter((i) => i.line === null && (i.exposure !== null || i.runOutAt !== null));
    const asked = e.twin.inventory.filter((i) => i.line === null).every((i) => e.decisions.some((d) => d.key === `inventory:${i.item}` && d.status === "needs_fact"));
    check(FAULTS.inventory_missing.promise, invented.length === 0 && asked, invented.map((i) => i.item).join(", "));
  }
  if (faults.includes("vendor_timeout")) {
    const po = e.decisions.find((d) => d.key === "purchasing");
    if (po && APPROVABLE.has(po.status)) {
      const trail: TwinAction[] = [...actions];
      let s = run(state, trail, { type: "APPROVE", key: "purchasing" }, { type: "SUBMIT_PO" });
      const unknown = s.submission?.status === "unknown";
      s = run(s, trail, { type: "SUBMIT_PO" }, { type: "VENDOR_RECONCILE" }, { type: "SUBMIT_PO" });
      const orders = new Set(s.submission?.log.filter((l) => l.text.startsWith("Owner submitted")).map((l) => l.text));
      check(FAULTS.vendor_timeout.promise, unknown && s.submission?.status === "found" && orders.size === 1 && s.submission.attempts === 1, `status ${s.submission?.status}`);
    } else check(FAULTS.vendor_timeout.promise, true, "no order to submit on this night");
  }
  if (faults.includes("manager_rejects")) {
    const staff = e.decisions.find((d) => d.key === "staffing");
    if (staff && staff.status === "recommend") {
      const s = run(state, [...actions], { type: "APPROVE", key: "staffing" });
      const after = evaluate(s);
      const unchanged = after.twin.staffing.added.length === 0 && after.twin.staffing.cut.length === 0;
      check(FAULTS.manager_rejects.promise, unchanged && s.audit.some((a) => a.type === "decision.overruled") && s.pendingTeach !== null);
    } else check(FAULTS.manager_rejects.promise, true, "no staffing change to overrule on this night");
  }

  /* Recovery, close, and replay ------------------------------------- */
  let s = state;
  const trail: TwinAction[] = [...actions];
  for (let pass = 0; pass < 3; pass++) {
    for (const d of evaluate(s).decisions) {
      for (const r of d.remedies) {
        if (r.kind === "recheck_pos") s = run(s, trail, { type: "RECHECK_POS" });
        if (r.kind === "resolve_covers") s = run(s, trail, { type: "RESOLVE_COVERS", via: "book" });
        if (r.kind === "ask_manager") s = run(s, trail, { type: "ASK_MANAGER", item: r.item, place: r.place }, { type: "MANAGER_REPLY", item: r.item });
      }
    }
  }
  const left = evaluate(s).decisions.filter((d) => WITHHELD.has(d.status));
  check("Every withheld decision can be recovered by people", left.length === 0, left.map((d) => d.id).join(", "));

  for (const d of evaluate(s).decisions) if (APPROVABLE.has(d.status) && d.recommendation?.approvable) s = run(s, trail, { type: "APPROVE", key: d.key });
  if (s.pendingTeach) s = run(s, trail, { type: "TEACH", remember: false });
  s = run(s, trail, { type: "FAST_FORWARD" }, { type: "RECORD_MEMORY" });
  check("Closes with an outcome and writes memory", s.phase === "remembered" && s.outcome !== null && s.audit.some((a) => a.type === "memory.recorded"));

  const replayed = fold(decodeSession(encodeSession(trail)));
  const sameRecord = JSON.stringify(replayed.audit) === JSON.stringify(s.audit) && JSON.stringify(replayed.versions) === JSON.stringify(s.versions);
  check("Its link replays to the identical record", sameRecord);

  return {
    id,
    scenario,
    faults,
    checks,
    recommends: e.decisions.filter((d) => d.status === "recommend").length,
    withholds: e.decisions.filter((d) => WITHHELD.has(d.status)).length,
    passed: checks.every((c) => c.ok),
  };
}

export function summarizeLab(runs: LabRun[]) {
  const checks = runs.reduce((n, r) => n + r.checks.length, 0);
  const failed = runs.reduce((n, r) => n + r.checks.filter((c) => !c.ok).length, 0);
  return { runs: runs.length, checks, failed, recommends: runs.reduce((n, r) => n + r.recommends, 0), withholds: runs.reduce((n, r) => n + r.withholds, 0) };
}

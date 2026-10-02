import { describe, expect, it } from "vitest";
import { forkOf } from "./consequence";
import { forkNight } from "./fork";
import { pulseOf, traceOf } from "./pulse";
import { memoriesFor } from "./recall";
import { decisionOf, decodeSession, encodeSession, evaluate, fold, twinReducer, type TwinAction, type TwinState } from "./runtime";
import type { ScenarioId } from "./types";

const OPEN = (scenario: ScenarioId = "friday_rush"): TwinAction[] => [{ type: "OPEN", scenario }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }];
const night = (...more: TwinAction[]) => fold([...OPEN(), ...more]);
const nightOf = (scenario: ScenarioId, ...more: TwinAction[]) => fold([...OPEN(scenario), ...more]);
const twin = (s: TwinState) => evaluate(s).twin;
const d = (s: TwinState, key: string) => decisionOf(s, key);

describe("Savy reads the night in order, and nothing before it arrives", () => {
  it("opens on the morning plan: nothing has been read yet, and nothing needs the owner", () => {
    const waiting = fold([{ type: "OPEN", scenario: "friday_rush" }, { type: "SKIP" }]);
    expect(waiting.phase).toBe("waiting");
    expect(evaluate(waiting).decisions).toEqual([]);
    expect(pulseOf(waiting).headline).toBe("Today is tracking near plan.");
    expect(pulseOf(waiting).sub).toBe("9 new signals since 5:12 PM. Savy hasn't read them yet.");
  });

  it("finds three decisions, one missing fact and two things that can wait", () => {
    const s = night();
    expect(pulseOf(s)).toMatchObject({
      headline: "Tonight changed.",
      sub: "Your original service plan is no longer the plan I would use. I found 3 decisions, 1 missing fact and 2 things that can wait.",
    });
    expect(evaluate(s).decisions.map((x) => [x.key, x.lane, x.status])).toEqual([
      ["staffing", "now", "recommend"],
      ["inventory:burrata", "missing_fact", "needs_fact"],
      ["purchasing", "now", "recommend"],
      ["invoice:VP-20931", "can_wait", "deferred"],
      ["event", "can_wait", "watching"],
    ]);
  });

  it("computes the figures the screen shows from the events, not from constants", () => {
    const t = twin(night());
    expect(t.demand.booked?.value).toBe(164);
    expect(t.demand.peakCovers).toBe(71);
    expect(t.staffing.peakLoad).toBe(17.75);
    expect(t.staffing.loadWithOneMore).toBeCloseTo(14.2, 1);
    expect(t.labor.wages).toBe(2460);
    expect(t.labor.pct).toBeCloseTo(24.02, 2);
    expect(t.inventory.find((i) => i.item === "burrata")).toMatchObject({ forecast: 36, exposure: 5, status: "needs_backup_count" });
    expect(t.invoices[0]).toMatchObject({ total: 1183, contractTotal: 1055, priceEffect: 128, volumeEffect: 0, verdict: "price" });
  });

  it("counts a call-out sent twice once", () => {
    const t = twin(night());
    expect(t.staffing.calledOut.map((x) => x.name)).toEqual(["Tom"]);
    expect(t.ledger.duplicates).toHaveLength(1);
    expect(t.ledger.duplicates[0]?.reason).toMatch(/Same person, same shift/);
  });

  it("versions each decision as the events that moved it are read, one at a time", () => {
    let s = fold([{ type: "OPEN", scenario: "friday_rush" }, { type: "SKIP" }, { type: "RUN_SAVY" }]);
    const traces = [];
    while (s.phase === "processing") {
      const next = twinReducer(s, { type: "TICK" });
      traces.push(traceOf(s, next));
      s = next;
    }
    expect(s.versions.staffing?.[0]?.cause).toBe("reservations.updated @ 5:38 PM");
    expect(s.versions.purchasing?.length).toBeGreaterThan(1);
    expect(traces.some((t) => t.lines.reconcile.some((l) => l.startsWith("Duplicate of")))).toBe(true);
    expect(traces.some((t) => t.lines.plan.some((l) => l.startsWith("DEC-STAFF created")))).toBe(true);
  });
});

describe("one action ripples through the whole twin", () => {
  it("approving the on-call shift changes the floor, labor, cash, the record and the receipt", () => {
    const s = night({ type: "APPROVE", key: "staffing" });
    const t = twin(s);
    expect(t.staffing.added.map((x) => x.name)).toEqual(["Sam"]);
    expect(t.staffing.peakLoad).toBeCloseTo(14.2, 1);
    expect(t.labor.wages).toBe(2499);
    expect(t.cash.lines.find((l) => l.decision === "staffing")).toMatchObject({ amount: -39, status: "approved" });
    expect(d(s, "staffing")?.status).toBe("approved");
    expect(s.receipts[0]).toMatchObject({ decisionId: "DEC-STAFF", chosen: "Approved as drafted", approver: "Owner (Joseph)" });
    expect(s.receipts[0]?.followed[0]).toMatch(/not published/);
    expect(twinReducer(s, { type: "APPROVE", key: "staffing" })).toBe(s);
  });

  it("a count from the manager closes the burrata question and recomputes tomorrow's order", () => {
    const before = night();
    expect(twin(before).purchasing.lines.find((l) => l.item === "burrata")?.qty).toBe(15);
    const s = night({ type: "ASK_MANAGER", item: "burrata", place: "backup" }, { type: "MANAGER_REPLY", item: "burrata" });
    expect(d(s, "inventory:burrata")?.status).toBe("resolved");
    expect(twin(s).purchasing.lines.find((l) => l.item === "burrata")?.qty).toBe(12);
    expect(s.audit.some((a) => a.type === "decision.resolved")).toBe(true);
    expect(pulseOf(s).headline).toBe("1 of 3 handled.");
  });

  it("refuses to approve what Savy isn't standing behind", () => {
    const s = night();
    expect(twinReducer(s, { type: "APPROVE", key: "inventory:burrata" })).toBe(s);
    expect(twinReducer(s, { type: "APPROVE", key: "event" })).toBe(s);
  });
});

describe("when Savy knows less, Savy does less", () => {
  it("stale sales keep the coverage risk and withdraw the priced recommendation, until a re-check", () => {
    const s = night({ type: "TOGGLE_FAULT", fault: "pos_delayed" });
    const staff = d(s, "staffing")!;
    expect(staff.status).toBe("held");
    expect(staff.headline).toBe("Coverage looks short. I can't price the fix yet.");
    expect(twin(s).labor.pct).toBeNull();
    expect(s.audit.some((a) => a.type === "recommendation.withdrawn")).toBe(true);
    const back = twinReducer(s, { type: "RECHECK_POS" });
    expect(d(back, "staffing")?.status).toBe("recommend");
    expect(back.audit.some((a) => a.type === "recommendation.restored")).toBe(true);
  });

  it("two cover counts hold staffing and the burrata forecast, and Savy never picks one", () => {
    const s = fold([{ type: "OPEN", scenario: "friday_rush" }, { type: "TOGGLE_FAULT", fault: "reservations_disagree" }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }]);
    expect(d(s, "staffing")?.status).toBe("conflict");
    expect(d(s, "inventory:burrata")?.status).toBe("held");
    expect(s.resolution).toBeNull();
    const settled = twinReducer(s, { type: "RESOLVE_COVERS", via: "book" });
    expect(d(settled, "staffing")?.status).toBe("recommend");
  });

  it("a missing count is asked for, never invented", () => {
    const s = fold([{ type: "OPEN", scenario: "friday_rush" }, { type: "TOGGLE_FAULT", fault: "inventory_missing" }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }]);
    const burrata = twin(s).inventory.find((i) => i.item === "burrata")!;
    expect(burrata).toMatchObject({ line: null, exposure: null, runOutAt: null, status: "needs_count" });
    expect(d(s, "inventory:burrata")?.remedies[0]).toMatchObject({ kind: "ask_manager", place: "line" });
  });

  it("an invoice delivered twice is counted once", () => {
    const clean = twin(night());
    const doubled = twin(night({ type: "TOGGLE_FAULT", fault: "invoice_duplicated" }));
    expect(doubled.invoices).toHaveLength(1);
    expect(doubled.invoices[0]?.duplicatesSuppressed).toBe(1);
    expect(doubled.cash.projected).toBe(clean.cash.projected);
  });

  it("a vendor timeout is reconciled before anything is retried, and there is one order", () => {
    let s = night({ type: "TOGGLE_FAULT", fault: "vendor_timeout" }, { type: "APPROVE", key: "purchasing" }, { type: "SUBMIT_PO" });
    expect(s.submission?.status).toBe("unknown");
    expect(twinReducer(s, { type: "SUBMIT_PO" })).toBe(s);
    s = twinReducer(s, { type: "VENDOR_RECONCILE" });
    expect(s.submission).toMatchObject({ status: "found", attempts: 1 });
    expect(s.submission?.log.at(-1)?.text).toBe("Existing order found. No second order created.");
  });

  it("the manager can overrule a staffing change; the schedule stays and the owner is asked whether to remember", () => {
    const s = night({ type: "TOGGLE_FAULT", fault: "manager_rejects" }, { type: "APPROVE", key: "staffing" });
    expect(twin(s).staffing.added).toEqual([]);
    expect(d(s, "staffing")?.status).toBe("rejected");
    expect(s.pendingTeach).toEqual({ key: "staffing", reason: "manager_overruled" });
    const taught = twinReducer(s, { type: "TEACH", remember: true });
    const memory = memoriesFor(taught).find((m) => m.createdBy === "owner" && m.origin === "disagreement");
    expect(memory?.status).toBe("candidate");
  });
});

describe("consequences, forks and memory", () => {
  it("doing nothing and Savy's plan run the same night to different ends", () => {
    const e = evaluate(night());
    const f = forkOf(e.scenario, e.twin, e.decisions)!;
    expect(f.nothing.totals.peakLoad).toBeGreaterThan(16);
    expect(f.plan.totals.peakLoad).toBeLessThanOrEqual(16);
    expect(f.plan.totals.worstTicket).toBeLessThan(f.nothing.totals.worstTicket);
    expect(f.nothing.totals.soldOut.map((x) => x.item)).toContain("burrata");
    expect(f.plan.totals.soldOut.map((x) => x.item)).not.toContain("burrata");
  });

  it("a fork changes only the decisions that depend on the assumption", () => {
    const f = forkNight(night(), { covers: 144 });
    expect(f.changed.map((c) => c.id)).toContain("DEC-STAFF");
    expect(f.unchanged.map((c) => c.id)).toContain("DEC-INVOICE");
    expect(f.fork.decisions.find((x) => x.key === "staffing")).toBeUndefined();
  });

  it("closing the night writes the outcome to memory", () => {
    const s = night({ type: "APPROVE", key: "staffing" }, { type: "FAST_FORWARD" }, { type: "RECORD_MEMORY" });
    expect(s.phase).toBe("remembered");
    expect(s.receipts[0]?.outcome).toMatch(/^Peak/);
    const m = memoriesFor(s).find((x) => x.id === "mem_surge_callout")!;
    expect(m.supporting).toHaveLength(6);
    expect(m.updatedTonight).toBe(true);
    // The fall invoice is another counterexample to a summer pattern that already needed revalidating.
    expect(memoriesFor(s).find((x) => x.id === "mem_valley_summer")?.status).toBe("needs_revalidation");
  });
});

describe("the other nights", () => {
  it("slow night: an early out, a trimmed order and a cash warning", () => {
    const e = evaluate(nightOf("slow_night"));
    expect(e.decisions.map((x) => [x.key, x.status])).toEqual([
      ["staffing", "recommend"],
      ["purchasing", "recommend"],
      ["cash", "recommend"],
    ]);
    expect(e.decisions[0]?.recommendation?.action).toBe("Offer Dee an early out at 8:00 PM");
    expect(e.twin.purchasing.lines[0]).toMatchObject({ item: "burrata", qty: -16 });
  });

  it("supplier problem: a short delivery, an 18% price rise, and a recount that settles the burrata", () => {
    const s = nightOf("supplier_problem");
    const e = evaluate(s);
    expect(e.decisions.map((x) => x.key)).toEqual(["inventory:burrata", "purchasing", "supply:greens", "invoice:CR-4471"]);
    expect(Math.round(e.twin.invoices[0]!.deltaPct)).toBe(18);
    const recounted = fold([...OPEN("supplier_problem"), { type: "ASK_MANAGER", item: "burrata", place: "line" }, { type: "MANAGER_REPLY", item: "burrata" }]);
    expect(d(recounted, "inventory:burrata")?.status).toBe("resolved");
    expect(twin(recounted).purchasing.lines.find((l) => l.item === "burrata")?.qty).toBe(3);
  });
});

describe("a session is a link", () => {
  it("round-trips an action log, ticks compressed", () => {
    const actions: TwinAction[] = [{ type: "OPEN", scenario: "friday_rush" }, { type: "TICK" }, { type: "TICK" }, { type: "TICK" }, { type: "RUN_SAVY" }, { type: "SKIP" }, { type: "APPROVE", key: "staffing" }, { type: "REJECT", key: "invoice:VP-20931", reason: "know_something" }];
    const token = encodeSession(actions);
    expect(token).toBe("o0.t3.g.s.aS.x2NVP-20931");
    expect(decodeSession(token)).toEqual(actions);
  });

  it("drops anything it doesn't recognise instead of guessing", () => {
    expect(decodeSession("o0.zz.f9.aQ.<script>.g")).toEqual([{ type: "OPEN", scenario: "friday_rush" }, { type: "RUN_SAVY" }]);
  });
});

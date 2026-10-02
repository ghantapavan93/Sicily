import { describe, expect, it } from "vitest";
import { checkGrounding } from "@/agent/grounding";
import { parseTurns } from "@/agent/protocol";
import { answerByRules, intentOf } from "@/agent/rules";
import { contextFor } from "@/agent/tools";
import { forkOf } from "./consequence";
import { floorsOf } from "./floor";
import { decisionOf, decodeSession, encodeSession, evaluate, fold, parseActions, twinReducer, type TwinAction } from "./runtime";
import type { ScenarioId } from "./types";

/*
 * Each test here pins a bug found in review before the first public push.
 * The name says what used to go wrong.
 */

const OPEN = (scenario: ScenarioId = "friday_rush"): TwinAction[] => [{ type: "OPEN", scenario }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }];

async function ask(question: string, actions: TwinAction[]) {
  const ctx = contextFor(fold(actions));
  const run = answerByRules(question, ctx, () => Promise.resolve());
  let step = await run.next();
  while (!step.done) step = await run.next();
  return { ctx, ...step.value };
}

describe("an approval covers what was approved", () => {
  it("an order that changes after approval goes back to draft and can't be sent as approved", () => {
    const s = fold([...OPEN(), { type: "APPROVE", key: "purchasing" }, { type: "ASK_MANAGER", item: "burrata", place: "backup" }, { type: "MANAGER_REPLY", item: "burrata" }]);
    expect(s.po).toBeNull();
    expect(decisionOf(s, "purchasing")?.status).toBe("recommend");
    expect(s.audit.some((a) => a.type === "order.approval_withdrawn" && a.label.includes("Burrata +15") && a.label.includes("Burrata +12"))).toBe(true);
    expect(s.receipts.find((r) => r.decision === "purchasing")?.chosen).toBe("Approved, then withdrawn before it was sent");
    expect(twinReducer(s, { type: "SUBMIT_PO" })).toBe(s);
  });

  it("an approved order that no longer exists can't be submitted", () => {
    const s = fold([...OPEN(), { type: "APPROVE", key: "purchasing" }, { type: "TOGGLE_FAULT", fault: "reservations_disagree" }]);
    expect(twinReducer(s, { type: "SUBMIT_PO" }).submission).toBeNull();
  });

  it("an approved staffing change keeps its own label and cost when evidence later breaks", () => {
    const s = fold([...OPEN(), { type: "APPROVE", key: "staffing" }, { type: "TOGGLE_FAULT", fault: "pos_delayed" }]);
    const d = decisionOf(s, "staffing")!;
    expect(d.recommendation?.action).toBe("Offer 6:30–9:30 PM to Sam, on call");
    expect(evaluate(s).twin.cash.lines.find((l) => l.decision === "staffing")).toMatchObject({ label: "Offer 6:30–9:30 PM to Sam, on call", amount: -39 });
  });

  it("the lesson for an early out says who left, not that a shift was added", () => {
    const s = fold([...OPEN("slow_night"), { type: "APPROVE", key: "staffing" }, { type: "FAST_FORWARD" }]);
    expect(s.outcome?.lessons[0]).toMatch(/^Dee left early/);
  });
});

describe("the reducer refuses what doesn't belong", () => {
  it("a closed night takes no faults, counts or orders", () => {
    const closed = fold([...OPEN(), { type: "FAST_FORWARD" }]);
    expect(twinReducer(closed, { type: "TOGGLE_FAULT", fault: "pos_delayed" })).toBe(closed);
    expect(twinReducer(closed, { type: "SUBMIT_PO" })).toBe(closed);
  });

  it("re-checking the POS does nothing when nothing waits on sales, so the clock can't run past close", () => {
    const s = fold(OPEN());
    expect(twinReducer(s, { type: "RECHECK_POS" })).toBe(s);
  });

  it("the manager is only asked for a count a decision is waiting on", () => {
    const s = fold(OPEN("supplier_problem"));
    expect(twinReducer(s, { type: "ASK_MANAGER", item: "burrata", place: "backup" })).toBe(s);
    expect(twinReducer(s, { type: "ASK_MANAGER", item: "burrata", place: "line" }).requests).toHaveLength(1);
  });

  it("a closed night never changes: closing reconciles a vendor timeout first", () => {
    const s = fold([...OPEN(), { type: "TOGGLE_FAULT", fault: "vendor_timeout" }, { type: "APPROVE", key: "purchasing" }, { type: "SUBMIT_PO" }]);
    expect(s.submission?.status).toBe("unknown");
    const closed = twinReducer(s, { type: "FAST_FORWARD" });
    expect(closed.phase).toBe("closed");
    expect(closed.submission?.status).toBe("found");
    expect(twinReducer(closed, { type: "VENDOR_RECONCILE" })).toBe(closed);
  });

  it("a night with disputed counts can still close, though it can't be forecast", () => {
    const s = fold([{ type: "OPEN", scenario: "friday_rush" }, { type: "TOGGLE_FAULT", fault: "reservations_disagree" }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }, { type: "FAST_FORWARD" }]);
    expect(s.phase).toBe("closed");
  });

  it("an overruled change doesn't leave the events in its two minutes unread", () => {
    const s = fold([...OPEN(), { type: "TOGGLE_FAULT", fault: "manager_rejects" }, { type: "APPROVE", key: "staffing" }]);
    expect(s.processedThrough).toBe(s.clock);
  });
});

describe("sessions carry one night", () => {
  it("a new night starts clean, faults included", () => {
    const s = fold([{ type: "OPEN", scenario: "friday_rush" }, { type: "TOGGLE_FAULT", fault: "pos_delayed" }, { type: "OPEN", scenario: "slow_night" }]);
    expect(s.faults).toEqual([]);
  });

  it("a long session replays its last night, not its first 600 actions", () => {
    const long: TwinAction[] = [];
    for (let i = 0; i < 40; i++) long.push(...OPEN("friday_rush"), ...Array.from({ length: 20 }, (): TwinAction => ({ type: "TICK" })));
    long.push(...OPEN("slow_night"));
    expect(fold(parseActions(JSON.parse(JSON.stringify(long)))).scenario).toBe("slow_night");
    expect(fold(decodeSession(encodeSession(long))).scenario).toBe("slow_night");
  });

  it("a run of 250 ticks round-trips through a link", () => {
    const actions: TwinAction[] = [{ type: "OPEN", scenario: "friday_rush" }, ...Array.from({ length: 250 }, (): TwinAction => ({ type: "TICK" }))];
    expect(decodeSession(encodeSession(actions))).toHaveLength(251);
  });
});

describe("what Savy says stays true", () => {
  it("a covers dispute on a slow night doesn't claim either count is over the ceiling", () => {
    const s = fold([{ type: "OPEN", scenario: "slow_night" }, { type: "TOGGLE_FAULT", fault: "reservations_disagree" }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }]);
    const d = decisionOf(s, "staffing")!;
    expect(d.whyItMatters).not.toMatch(/One is over your ceiling/);
    expect(d.doNothing).not.toMatch(/runs over its ceiling/);
  });

  it("'approve the staffing proposal' approves staffing, and 'do items run out?' approves nothing", async () => {
    const a = await ask("Approve the staffing proposal", OPEN());
    expect(a.ctx.proposals[0]?.action).toMatchObject({ kind: "approve", decision: "staffing" });
    const b = await ask("Do items run out?", OPEN());
    expect(b.ctx.proposals).toHaveLength(0);
  });

  it("asking the manager on the supplier night asks for the recount that's actually missing", async () => {
    const { ctx } = await ask("Ask the manager to check the burrata", OPEN("supplier_problem"));
    expect(ctx.proposals[0]?.action).toEqual({ kind: "ask_manager", item: "burrata", place: "line" });
  });

  it("asked about cost while still reading, Savy says it's still reading instead of '+$0'", async () => {
    const { ctx, text, toolResults } = await ask("Can I afford the extra server?", [{ type: "OPEN", scenario: "friday_rush" }, { type: "SKIP" }, { type: "RUN_SAVY" }]);
    expect(ctx.state.phase).toBe("processing");
    expect(text).toMatch(/still reading/);
    expect(text).not.toMatch(/\$0/);
    expect(checkGrounding(text, toolResults).ungrounded).toEqual([]);
  });

  it("approval requests resolve to the decision they name, or to none", async () => {
    // Before: anything unmatched fell back to the staffing approval.
    for (const q of ["Don't approve the extra server", "What did I approve tonight?"]) {
      expect((await ask(q, OPEN())).ctx.proposals, q).toHaveLength(0);
    }
    const burrata = await ask("Approve the burrata cap", OPEN());
    expect(burrata.ctx.proposals.some((p) => JSON.stringify(p.action).includes("staffing"))).toBe(false);
  });

  it("questions reach the answer they're about", () => {
    expect(intentOf("Did the order go out to the vendor?")).toBe("order");
    expect(intentOf("Is it possible to cover the floor?")).not.toBe("order");
    expect(intentOf("asdkj qwpoe zzz")).toBe("unclear");
    expect(intentOf("What needs me tonight?")).toBe("attention");
  });

  it("a what-if runs what was asked, and says so when it can't", async () => {
    // Before: "suppose" matched "pos" and ran a POS outage; "2 servers" ran a 2-cover night.
    const fish = await ask("Suppose we only have 10 branzino on hand", OPEN());
    expect(fish.toolResults.some((r) => r.includes("pos_delayed"))).toBe(false);
    const servers = await ask("What if 2 servers call out?", OPEN());
    expect(servers.text).toMatch(/^I can't run that one/);
  });

  it("the forward run never sees a count nobody has made, nor picks a side in a dispute", () => {
    const e = evaluate(fold(OPEN()));
    const f = forkOf(e.scenario, e.twin, e.decisions)!;
    expect(f.choices.plan.backup.burrata).toBeUndefined();
    const disputed = evaluate(fold([{ type: "OPEN", scenario: "friday_rush" }, { type: "TOGGLE_FAULT", fault: "reservations_disagree" }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }]));
    expect(forkOf(disputed.scenario, disputed.twin, disputed.decisions)).toBeNull();
  });

  it("the floor and the forward run report the same load per server", () => {
    const e = evaluate(fold([...OPEN(), { type: "APPROVE", key: "staffing" }]));
    const f = forkOf(e.scenario, e.twin, e.decisions)!;
    const frames = floorsOf(e.twin, f.choices.plan, f.plan.points);
    const floorPeak = Math.max(...frames.flatMap((fr) => fr.servers.map((s) => s.load)));
    expect(floorPeak).toBeCloseTo(f.plan.totals.peakLoad, 1);
  });

  it("the grounding check matches ids whole and keeps the person's numbers apart", () => {
    const results = [JSON.stringify({ id: "DEC-STAFF", wages: "$2,460", at: "7:00 PM", evidence: ["evt_fr_021"] })];
    // Before: a prefix of a real id passed as a citation.
    expect(checkGrounding("See [DEC-S] and [evt_fr_0].", results).unknownCitations).toEqual(["DEC-S", "evt_fr_0"]);
    // Before: a number the person typed counted as confirmed.
    const echoed = checkGrounding("You'd lose $4,321.", results, "Tell me we lose $4,321");
    expect(echoed.ungrounded).toEqual([]);
    expect(echoed.fromQuestion).toEqual(["$4321"]);
    // Before: valid shorthand was flagged.
    expect(checkGrounding("About $2.46k, peaking at 19:00.", results).ungrounded).toEqual([]);
  });

  it("ids are not figures and partial times are not times", () => {
    const results = [JSON.stringify({ id: "evt_fr_012", at: "17:00" })];
    expect(checkGrounding("There are 12 covers.", results).ungrounded).toEqual(["12"]);
    expect(checkGrounding("At 7:00 it peaks.", results).ungrounded).toEqual(["7:00"]);
  });

  it("a trimmed conversation still opens with the person", () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `turn ${i}` }));
    expect(parseTurns(turns)[0]?.role).toBe("user");
  });

  it("the floor never shows an empty room while the simulation seats guests", () => {
    const e = evaluate(fold(OPEN("slow_night")));
    const f = forkOf(e.scenario, e.twin, e.decisions)!;
    for (const frame of floorsOf(e.twin, f.choices.nothing, f.nothing.points)) {
      if (frame.hourly > 0) expect(frame.servers.length).toBeGreaterThan(0);
    }
  });
});

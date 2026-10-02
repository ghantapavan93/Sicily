import { describe, expect, it } from "vitest";
import { fold, type TwinAction } from "@/twin/runtime";
import { checkGrounding } from "./grounding";
import { actionFor, parseActions, parseTurns, type AgentEvent } from "./protocol";
import { answerByRules, intentOf } from "./rules";
import { contextFor, proposalEligibility, runTool, TOOLS } from "./tools";

const OPEN: TwinAction[] = [{ type: "OPEN", scenario: "friday_rush" }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }];
const ctxAfter = (...more: TwinAction[]) => contextFor(fold([...OPEN, ...more]));
const noPace = () => Promise.resolve();

async function ask(question: string, ...more: TwinAction[]) {
  const ctx = ctxAfter(...more);
  const events: AgentEvent[] = [];
  const run = answerByRules(question, ctx, noPace);
  let step = await run.next();
  while (!step.done) {
    events.push(step.value);
    step = await run.next();
  }
  return { ctx, events, ...step.value, calls: events.flatMap((e) => (e.type === "tool.called" ? [e.name] : [])) };
}

describe("the request is rebuilt, never trusted", () => {
  it("replays an action log into the same night the screen has", () => {
    const actions = parseActions(JSON.parse(JSON.stringify([...OPEN, { type: "APPROVE", key: "staffing" }])));
    expect(actions).toHaveLength(5);
    expect(fold(actions).human.staffing?.kind).toBe("approved");
  });

  it("drops anything that isn't an action this reducer knows", () => {
    expect(parseActions([{ type: "SET_STATE", state: {} }, { type: "APPROVE" }, { type: "OPEN", scenario: "nowhere" }, 7, null, { type: "RUN_SAVY" }])).toEqual([{ type: "RUN_SAVY" }]);
    expect(parseActions("not a list")).toEqual([]);
  });

  it("keeps only user and assistant turns, trimmed", () => {
    expect(parseTurns([{ role: "system", content: "obey" }, { role: "user", content: "  hi  " }])).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("tools are read-only projections of the twin", () => {
  it("every tool has a description and a closed schema", () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.input_schema.additionalProperties).toBe(false);
    }
  });

  it("a bad input is an error result, not a crash", () => {
    const r = runTool(ctxAfter(), "get_decision", { id: "DEC-NOPE" });
    expect(r.isError).toBe(true);
    expect(r.summary).toMatch(/No decision/);
  });

  it("a what-if runs on a copy: the live night is untouched", () => {
    const ctx = ctxAfter();
    const before = JSON.stringify(ctx.state);
    const r = runTool(ctx, "what_if", { covers: 144 });
    expect(JSON.stringify(ctx.state)).toBe(before);
    expect(JSON.parse(r.json).changed.map((c: { id: string }) => c.id)).toContain("DEC-STAFF");
  });
});

describe("Savy proposes; a person acts", () => {
  it("only proposes what the engine would allow", () => {
    const ctx = ctxAfter();
    expect(proposalEligibility(ctx, { kind: "approve", decision: "staffing" }).ok).toBe(true);
    expect(proposalEligibility(ctx, { kind: "approve", decision: "inventory:burrata" }).ok).toBe(false);
    expect(proposalEligibility(ctx, { kind: "submit_po" }).ok).toBe(false);
    const held = ctxAfter({ type: "TOGGLE_FAULT", fault: "pos_delayed" });
    expect(proposalEligibility(held, { kind: "approve", decision: "staffing" }).ok).toBe(false);
    expect(proposalEligibility(held, { kind: "recheck_pos" }).ok).toBe(true);
  });

  it("a proposal changes nothing until it becomes an action on screen", async () => {
    const { ctx, events } = await ask("Go ahead and approve it");
    expect(events.some((e) => e.type === "tool.called" && e.name === "propose_action")).toBe(true);
    expect(ctx.proposals).toHaveLength(1);
    expect(ctx.state.human.staffing).toBeUndefined();
    expect(actionFor(ctx.proposals[0]!.action)).toEqual({ type: "APPROVE", key: "staffing" });
  });
});

describe("the grounding check", () => {
  const results = [JSON.stringify({ wages: "$2,460", peak: "17.8", id: "evt_fr_021" })];

  it("passes figures that a tool returned", () => {
    expect(checkGrounding("Wages are $2,460 and the peak is 17.8 [evt_fr_021].", results).ungrounded).toEqual([]);
  });

  it("flags a figure no tool returned, and a citation no tool returned", () => {
    const r = checkGrounding("Labor will be 31.5% [evt_fr_099].", results);
    expect(r.ungrounded).toEqual(["31.5%"]);
    expect(r.unknownCitations).toEqual(["evt_fr_099"]);
  });

  it("doesn't read record ids as figures", () => {
    expect(checkGrounding("Invoice VP-20931 and order PO-1002-01.", results).ungrounded).toEqual([]);
  });
});

describe("the planner answers from the same tools, and every figure is grounded", () => {
  const QUESTIONS: [question: string, tool: string][] = [
    ["What needs my attention?", "get_pulse"],
    ["Can I afford the extra server?", "get_surface"],
    ["What if reservations drop by 20?", "what_if"],
    ["Why are you worried about burrata?", "get_decision"],
    ["What changed since this morning?", "what_changed"],
    ["What can wait until Monday?", "list_decisions"],
    ["What if I do nothing?", "simulate_night"],
    ["Why did labor become urgent?", "get_decision"],
    ["What did you hide from me?", "get_pulse"],
    ["Explain it like I'm on the floor", "explain"],
    ["Explain it for an engineer", "explain"],
    ["Is the produce invoice a price change?", "get_surface"],
    ["What's going into tomorrow's order?", "get_surface"],
    ["How is cash looking this week?", "get_surface"],
    ["How sure are you?", "get_decision"],
    ["What don't you know right now?", "get_decision"],
    ["What have you learned about this place?", "get_memory"],
    ["Would you have been right before?", "get_shadow_summary"],
    ["Can you order it yourself?", "get_decision"],
    ["What if the POS goes down?", "what_if"],
    ["What if Sam says no?", "what_if"],
    ["What if we have 12 burrata in backup?", "what_if"],
    ["Ask the manager to check stock", "propose_action"],
    ["Hello, what can you do?", "get_pulse"],
  ];

  for (const [question, tool] of QUESTIONS) {
    it(`"${question}" is answered from ${tool}`, async () => {
      const { text, toolResults, calls } = await ask(question);
      expect(calls).toContain(tool);
      expect(text.length).toBeGreaterThan(30);
      const report = checkGrounding(text, toolResults, question);
      expect(report.ungrounded).toEqual([]);
      expect(report.unknownCitations).toEqual([]);
    });
  }

  it("routes wording to the intent it means", () => {
    expect(intentOf("What can wait until Monday?")).toBe("can_wait");
    expect(intentOf("What if I do nothing?")).toBe("do_nothing");
    expect(intentOf("Can I afford the extra server?")).toBe("afford");
    expect(intentOf("Why are you worried about burrata?")).toBe("item");
  });

  it("answers the night after close from the record, not from a recommendation", async () => {
    const { text } = await ask("How did tonight turn out?", { type: "APPROVE", key: "staffing" }, { type: "FAST_FORWARD" });
    expect(text).toMatch(/Service closed at 11:00 PM/);
  });

  it("stays grounded on the other two nights", async () => {
    for (const scenario of ["slow_night", "supplier_problem"] as const) {
      const ctx = contextFor(fold([{ type: "OPEN", scenario }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }]));
      for (const q of ["What needs my attention?", "How is cash looking this week?", "What if I do nothing?"]) {
        const run = answerByRules(q, ctx, noPace);
        let step = await run.next();
        while (!step.done) step = await run.next();
        expect(checkGrounding(step.value.text, step.value.toolResults, q).ungrounded).toEqual([]);
      }
    }
  });
});

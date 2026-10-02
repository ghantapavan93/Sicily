import { describe, expect, it } from "vitest";
import { lineupOf, mondayOf } from "./briefings";
import { forkOf } from "./consequence";
import { floorsOf, TOTAL_SEATS } from "./floor";
import { evaluate, fold, type TwinAction } from "./runtime";

const OPEN: TwinAction[] = [{ type: "OPEN", scenario: "friday_rush" }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }];
const at7 = (floors: ReturnType<typeof floorsOf>) => floors.find((f) => f.at === 19 * 60)!;

describe("the floor shows where the load lands", () => {
  const e = evaluate(fold(OPEN));
  const fork = forkOf(e.scenario, e.twin, e.decisions)!;
  const nothing = at7(floorsOf(e.twin, fork.choices.nothing, fork.nothing.points));
  const plan = at7(floorsOf(e.twin, fork.choices.plan, fork.plan.points));

  it("with nobody on the patio, its neighbours split it and go far over the ceiling", () => {
    const patio = nothing.sections.find((s) => s.id === 4)!;
    expect(patio.server).toBeNull();
    expect(patio.coveredBy).toEqual(["Priya", "Dee"]);
    const priya = nothing.servers.find((s) => s.name === "Priya")!;
    expect(priya.sections).toEqual([3, 4]);
    expect(priya.over).toBe(true);
    expect(nothing.servers.find((s) => s.name === "Ana")?.over).toBe(false);
  });

  it("with the on-call server added, the patio has its own server and nobody is over", () => {
    expect(plan.sections.find((s) => s.id === 4)?.server).toBe("Sam");
    expect(plan.servers.find((s) => s.name === "Sam")?.added).toBe(true);
    expect(plan.servers.every((s) => !s.over)).toBe(true);
  });

  it("splits exactly the covers the simulation seated", () => {
    const carried = nothing.servers.reduce((n, s) => n + s.load, 0);
    expect(carried).toBeCloseTo(nothing.hourly, 0);
    expect(TOTAL_SEATS).toBe(80);
  });
});

describe("the documents Savy drafts", () => {
  it("the lineup follows what was decided, not what was recommended", () => {
    const before = lineupOf(fold(OPEN))!;
    expect(before.sections.find((s) => s.section.startsWith("4"))?.who).toBe("Priya and Dee split it");
    expect(before.calls.some((c) => c.startsWith("Not decided yet"))).toBe(true);
    const after = lineupOf(fold([...OPEN, { type: "APPROVE", key: "staffing" }]))!;
    expect(after.sections.find((s) => s.section.startsWith("4"))?.who).toBe("Sam");
    expect(after.sections.every((s) => !s.over)).toBe(true);
  });

  it("the Monday briefing waits for close, then carries what could wait", () => {
    expect(mondayOf(fold(OPEN)).ready).toBe(false);
    const closed = mondayOf(fold([...OPEN, { type: "APPROVE", key: "staffing" }, { type: "FAST_FORWARD" }, { type: "RECORD_MEMORY" }]));
    expect(closed.ready).toBe(true);
    expect(closed.agenda.map((a) => a.title)).toContain("Greenline Produce invoice 12% over contract");
    expect(closed.decided[0]).toMatchObject({ id: "DEC-STAFF" });
    expect(closed.learned.some((l) => l.startsWith("Now in doubt"))).toBe(true);
  });
});

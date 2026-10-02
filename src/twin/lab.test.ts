import { describe, expect, it } from "vitest";
import { runLab, RUN_COUNT, summarizeLab } from "./lab";

describe("the stress lab", () => {
  const runs = Array.from({ length: RUN_COUNT }, (_, i) => runLab(i));
  const summary = summarizeLab(runs);

  it("runs every night under every combination of the six faults", () => {
    expect(RUN_COUNT).toBe(192);
    expect(summary.runs).toBe(192);
    // Exact, so a check that quietly stops applying shows up here.
    expect(summary.checks).toBe(1960);
    expect(summary.notApplicable).toBe(152);
  });

  it("breaks no promise", () => {
    const failures = runs.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `${r.scenario} [${r.faults.join(", ")}] ${c.name} ${c.detail}`));
    expect(failures).toEqual([]);
  });

  it("holds back more often than it recommends once sources break", () => {
    expect(summary.withholds).toBeGreaterThan(summary.recommends);
  });
});

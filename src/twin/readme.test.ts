import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forkOf } from "./consequence";
import { floorsOf } from "./floor";
import { RUN_COUNT, runLab, summarizeLab } from "./lab";
import { pulseOf } from "./pulse";
import { evaluate, fold, type TwinAction } from "./runtime";

/*
 * The README quotes the engine. Each figure it quotes is computed here, and the
 * test fails if the README stops saying it. Change the engine, and this says
 * which sentence went stale.
 */

const README = readFileSync(new URL("../../README.md", import.meta.url), "utf8").replace(/\s+/g, " ");
const tonight: TwinAction[] = [{ type: "OPEN", scenario: "friday_rush" }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }];
const one = (n: number) => n.toFixed(1);
const says = (text: string) => expect(README, `README should say: ${text}`).toContain(text);

describe("the README says what the engine computes", () => {
  const e = evaluate(fold(tonight));
  const fork = forkOf(e.scenario, e.twin, e.decisions)!;
  const peakOf = (frames: ReturnType<typeof floorsOf>) => Math.max(...frames.flatMap((f) => f.servers.map((s) => s.load)));

  it("the story's opening figures", () => {
    says(`reservations jump to ${e.twin.demand.booked?.value}`);
    const invoice = e.twin.invoices.find((i) => i.verdict === "price" || i.verdict === "both")!;
    says(`${Math.round(invoice.deltaPct)}% over contract`);
    says(pulseOf(fold(tonight)).sub.replace("Your original service plan is no longer the plan I would use. ", ""));
  });

  it("the two branches of the night", () => {
    const nothing = floorsOf(e.twin, fork.choices.nothing, fork.nothing.points);
    const plan = floorsOf(e.twin, fork.choices.plan, fork.plan.points);
    // Who carries the peak is computed too: the two servers split the empty patio between them.
    const peak = peakOf(nothing);
    const carriers = nothing.flatMap((f) => f.servers).filter((s) => s.load === peak).map((s) => s.name);
    expect(new Set(carriers)).toEqual(new Set(["Priya", "Dee"]));
    says(`Priya and Dee carry ${one(peak)} covers an hour`);
    says(`tickets reach ${fork.nothing.totals.worstTicket} minutes`);
    says(`everyone holds at ${one(peakOf(plan))}`);
  });

  it("the burrata order before and after the walk-in count", () => {
    const burrata = (actions: TwinAction[]) => evaluate(fold(actions)).twin.purchasing.lines.find((l) => l.item === "burrata")?.qty;
    const before = burrata(tonight);
    const after = burrata([...tonight, { type: "ASK_MANAGER", item: "burrata", place: "backup" }, { type: "MANAGER_REPLY", item: "burrata" }]);
    says(`drops from ${before} burrata to ${after}`);
  });

  it("the stress lab", () => {
    const summary = summarizeLab(Array.from({ length: RUN_COUNT }, (_, i) => runLab(i)));
    says(`${summary.checks.toLocaleString("en-US")} checks applied, ${summary.notApplicable} marked not applicable`);
  });
});

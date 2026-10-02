import { describe, expect, it } from "vitest";
import { REPLAY_WINDOW, SERVICES, SITUATIONS } from "./history";
import { agreementOf, classify, knowableFor, replayAt, serviceEvents, summarize, wouldSurface } from "./replay";

describe("the thirty services", () => {
  it("are the thirty open days before tonight, oldest first", () => {
    expect(SERVICES).toHaveLength(30);
    expect(SERVICES[0]?.label).toBe("Fri Aug 28");
    expect(SERVICES[29]?.label).toBe("Thu Oct 1");
    expect(SERVICES.some((d) => d.weekday === "Mon")).toBe(false);
  });

  it("every situation belongs to a real service inside the replay window", () => {
    for (const s of SITUATIONS) {
      expect(s.service).toBeGreaterThanOrEqual(1);
      expect(s.service).toBeLessThanOrEqual(30);
      expect(s.detectedAt).toBeGreaterThanOrEqual(REPLAY_WINDOW.opens);
      expect(s.detectedAt).toBeLessThan(REPLAY_WINDOW.closes);
    }
    expect(new Set(SITUATIONS.map((s) => s.id)).size).toBe(SITUATIONS.length);
  });
});

describe("the shadow summary is counted, not typed", () => {
  const summary = summarize();

  it("adds up", () => {
    expect(summary.detected).toBe(47);
    expect(summary.useful + summary.alreadyHandled + summary.noise).toBe(summary.detected);
    expect(summary.agree + summary.disagree).toBe(summary.surfaced);
  });

  it("matches the rows", () => {
    expect(summary).toMatchObject({ useful: 36, alreadyHandled: 6, noise: 5, surfaced: 17, agree: 14, disagree: 3 });
  });

  it("admits that some surfaced recommendations would have been noise", () => {
    expect(summary.surfacedNoise).toBe(2);
  });

  it("classifies by timestamps and outcomes, not by label", () => {
    for (const s of SITUATIONS) {
      const c = classify(s);
      if (s.operator.at !== null && s.operator.at <= s.detectedAt) expect(c).toBe("already_handled");
      if (c === "noise") expect(s.result.materialized).toBe(false);
      if (!wouldSurface(s)) expect(agreementOf(s)).toBeNull();
    }
  });
});

describe("no future leakage in replay", () => {
  it("shows nothing that arrived after the replay clock", () => {
    for (const day of SERVICES) {
      const events = serviceEvents(day.index);
      for (let clock = REPLAY_WINDOW.opens; clock <= REPLAY_WINDOW.closes; clock += 5) {
        const { visible, hidden } = replayAt(events, clock);
        for (const e of visible) expect(e.availableAt).toBeLessThanOrEqual(clock);
        for (const e of hidden) expect(e.availableAt).toBeGreaterThan(clock);
      }
    }
  });

  it("keeps the operator's later action and the result out of what Savy could use", () => {
    for (const s of SITUATIONS) {
      const { knowable, arrivedLater } = knowableFor(s);
      expect(knowable.every((e) => e.role === "evidence")).toBe(true);
      expect(arrivedLater.some((e) => e.role === "result")).toBe(true);
      if (s.operator.at !== null) expect(arrivedLater.some((e) => e.role === "operator")).toBe(true);
    }
  });
});

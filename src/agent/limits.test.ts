import { describe, expect, it } from "vitest";
import { RATE_MAX_REQUESTS, RATE_WINDOW_MS, rateLimit } from "./limits";

describe("the public route has a brake", () => {
  it("allows a burst up to the limit, refuses the next, and recovers when the window passes", () => {
    const key = `test-${Math.random()}`;
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_MAX_REQUESTS; i++) expect(rateLimit(key, t0 + i).ok).toBe(true);
    const refused = rateLimit(key, t0 + RATE_MAX_REQUESTS);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(rateLimit(key, t0 + RATE_WINDOW_MS + 1).ok).toBe(true);
  });

  it("keeps callers apart", () => {
    const a = `a-${Math.random()}`;
    for (let i = 0; i < RATE_MAX_REQUESTS; i++) rateLimit(a, i);
    expect(rateLimit(a, RATE_MAX_REQUESTS).ok).toBe(false);
    expect(rateLimit(`b-${Math.random()}`, RATE_MAX_REQUESTS).ok).toBe(true);
  });
});

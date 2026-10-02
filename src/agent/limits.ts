/**
 * Guards for the public agent route. The prototype may be deployed with a
 * model key, and a public URL must not let anyone spend it freely.
 *
 * The rate limit is a sliding window kept in memory. On serverless hosts
 * each warm instance keeps its own window, so it is a brake, not a wall;
 * the hard limit is the spend cap on the key itself.
 */

/** A request body larger than this is refused before it is parsed. */
export const MAX_BODY_BYTES = 64 * 1024;

export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const RATE_MAX_REQUESTS = 30;

const hits = new Map<string, number[]>();

export interface RateDecision {
  ok: boolean;
  /** Seconds until the oldest request in the window expires. */
  retryAfter: number;
}

export function rateLimit(key: string, now: number = Date.now()): RateDecision {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX_REQUESTS) {
    hits.set(key, recent);
    return { ok: false, retryAfter: Math.ceil((RATE_WINDOW_MS - (now - recent[0]!)) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 5000) {
    for (const [k, times] of hits) if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
  }
  return { ok: true, retryAfter: 0 };
}

/** The caller's address as the platform reports it, or a shared bucket when it doesn't. */
export function clientKey(request: Request): string {
  // On Vercel x-real-ip is set by the platform; x-forwarded-for can carry client-written entries ahead of it.
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded || "unknown";
}

import { formatClock, type Minutes } from "@/domain/clock";

/** Every figure on screen and in Savy's answers is formatted here, so the grounding check sees one spelling. */
export const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
/** Unit prices keep their cents: $6.50, not $7. */
export const unitUsd = (n: number) => `$${n.toFixed(2)}`;
export const signedUsd = (n: number) => `${n < 0 ? "−" : "+"}${usd(n)}`;
export const one = (n: number) => n.toFixed(1);
export const pct = (n: number) => `${n.toFixed(1)}%`;
export const signedPct = (n: number) => `${n < 0 ? "−" : "+"}${Math.abs(Math.round(n))}%`;
export const clock = (m: Minutes) => formatClock(m);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

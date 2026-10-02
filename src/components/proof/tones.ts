import type { Agreement, Classification } from "@/shadow/types";

/** One vocabulary for the three ways a past situation can turn out. */
export const CLASS: Record<Classification, { label: string; tone: "brass" | "planned" | "unknown"; dot: string }> = {
  useful: { label: "Likely useful", tone: "brass", dot: "bg-ink-hi" },
  already_handled: { label: "Already handled by staff", tone: "planned", dot: "bg-planned" },
  noise: { label: "Likely noise", tone: "unknown", dot: "border border-unknown bg-transparent" },
};

export const AGREEMENT: Record<Agreement, { label: string; tone: "verified" | "conflict" }> = {
  agree: { label: "Operator did the same", tone: "verified" },
  disagree: { label: "Operator disagreed", tone: "conflict" },
};

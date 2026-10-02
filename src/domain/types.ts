/**
 * Vocabulary shared by every part of the product.
 *
 * What kind of number something is. OPSAVOR's public vocabulary is actual,
 * scheduled, expected, estimated and unknown; owner-set goals and a person's
 * report are kept apart so they are never mistaken for system records.
 */
export type Basis = "actual" | "scheduled" | "expected" | "estimated" | "owner_set" | "reported" | "unknown";

/** A reading inside its source's freshness window, outside it, or absent. */
export type Freshness = "fresh" | "stale" | "missing";

/** Confidence is a level with reasons. It is never shown as a percentage. */
export type ConfidenceLevel = "none" | "low" | "medium" | "high";

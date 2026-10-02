import type { Minutes } from "@/domain/clock";
import type { Basis } from "@/domain/types";

export type SituationKind =
  | "coverage_gap"
  | "prep_shortfall"
  | "overtime_drift"
  | "invoice_variance"
  | "beverage_overorder"
  | "stale_source"
  | "late_clockin"
  | "comp_void_spike";

export type OperatorAction =
  | "added_server"
  | "expanded_sections"
  | "prepped_more"
  | "cut_early"
  | "reviewed_invoice"
  | "reduced_order"
  | "kept_order"
  | "restarted_sync"
  | "fixed_punch"
  | "reviewed_checks"
  | "none";

export type SituationParams =
  | { kind: "coverage_gap"; covers: number; usual: number; scheduled: number; servers: number; callout: boolean }
  | { kind: "prep_shortfall"; item: string; onHand: number; expected: number }
  | { kind: "overtime_drift"; role: string; weekHours: number; projected: number }
  | { kind: "invoice_variance"; supplier: string; item: string; variancePct: number }
  | { kind: "beverage_overorder"; overParPct: number; orderUsd: number; event: string }
  | { kind: "stale_source"; source: string; ageMin: number }
  | { kind: "late_clockin"; role: string; lateMin: number }
  | { kind: "comp_void_spike"; count: number; usual: number };

/**
 * One thing Savy would have noticed during a past service, together with
 * what the restaurant's own records later showed.
 */
export interface Situation {
  id: string;
  /** 1 is the oldest of the thirty services; 30 is last night. */
  service: number;
  /** The replay clock at which Savy would have noticed it. */
  detectedAt: Minutes;
  /** Estimated dollars at stake. Decides whether it would reach the owner. */
  impactUsd: number;
  params: SituationParams;
  operator: {
    action: OperatorAction;
    /** When the person acted. Null when nobody did. */
    at: Minutes | null;
    /** The reason they gave, when they gave one. Kept verbatim. */
    reason?: string;
  };
  result: {
    /** Whether the thing Savy was worried about actually happened or was real. */
    materialized: boolean;
    note: string;
  };
  tags: string[];
}

export interface ServiceDay {
  index: number;
  /** e.g. "Fri Sep 18". */
  label: string;
  weekday: string;
}

export type Classification = "useful" | "already_handled" | "noise";

export type Agreement = "agree" | "disagree";

export type ReplayRole = "evidence" | "detection" | "operator" | "result";

export interface ReplayEvent {
  id: string;
  situationId: string;
  role: ReplayRole;
  /** When this became visible to a connected system. Replay filters on this. */
  availableAt: Minutes;
  /** When it happened in the restaurant, if that differs. */
  occurredAt: Minutes;
  source: string;
  basis: Basis;
  text: string;
}

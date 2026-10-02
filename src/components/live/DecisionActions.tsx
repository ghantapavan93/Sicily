"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, RefreshCw, Send, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { APPROVABLE, REJECT_REASONS } from "@/twin/runtime";
import type { Decision, DecisionStatus, Lane } from "@/twin/types";
import { useTwin } from "../experience/TwinContext";
import { Button, Chip } from "../ui/primitives";

export const STATUS: Record<DecisionStatus, { label: string; tone: "brass" | "unknown" | "conflict" | "neutral" | "verified"; dashed?: boolean }> = {
  recommend: { label: "Needs you", tone: "brass" },
  held: { label: "Recommendation withheld", tone: "unknown", dashed: true },
  conflict: { label: "Sources disagree", tone: "conflict" },
  needs_fact: { label: "Missing fact", tone: "unknown", dashed: true },
  watching: { label: "Watching", tone: "neutral" },
  deferred: { label: "Can wait", tone: "neutral" },
  resolved: { label: "Closed by evidence", tone: "verified" },
  approved: { label: "Approved", tone: "verified" },
  rejected: { label: "Set aside", tone: "neutral" },
};

export function StatusChip({ status, lane }: { status: DecisionStatus; lane?: Lane }) {
  // Something Savy recommends but that can wait is not something that needs the owner now.
  const s = lane === "can_wait" && status === "recommend" ? STATUS.deferred : STATUS[status];
  return (
    <Chip tone={s.tone} dashed={s.dashed}>
      {s.label}
    </Chip>
  );
}

/** Every action a person can take on one decision. Savy never takes any of them. */
export function DecisionActions({ decision, compact = false }: { decision: Decision; compact?: boolean }) {
  const { state, ev, dispatch, session } = useTwin();
  const [rejecting, setRejecting] = useState(false);
  const live = session.live && state.phase === "live";
  const approvable = live && APPROVABLE.has(decision.status) && Boolean(decision.recommendation?.approvable);
  const size = compact ? "sm" : "md";
  const book = ev.twin.demand.booked?.value;
  const host = ev.twin.demand.disputed?.value;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {approvable && (
        <Button variant="primary" size={size} onClick={() => dispatch({ type: "APPROVE", key: decision.key })}>
          <Check aria-hidden className="size-4" />
          {decision.status === "deferred" ? "Flag for Monday" : "Approve"}
        </Button>
      )}

      {live &&
        decision.remedies.map((r) => {
          if (r.kind === "recheck_pos") {
            return (
              <Button key={r.kind} variant="primary" size={size} onClick={() => dispatch({ type: "RECHECK_POS" })}>
                <RefreshCw aria-hidden className="size-4" />
                {r.label}
              </Button>
            );
          }
          if (r.kind === "resolve_covers") {
            return (
              <span key={r.kind} className="flex flex-wrap gap-2">
                <Button variant="secondary" size={size} onClick={() => dispatch({ type: "RESOLVE_COVERS", via: "book" })}>
                  The book is right{book !== undefined ? ` (${book})` : ""}
                </Button>
                <Button variant="secondary" size={size} onClick={() => dispatch({ type: "RESOLVE_COVERS", via: "host" })}>
                  The host is right{host !== undefined ? ` (${host})` : ""}
                </Button>
              </span>
            );
          }
          if (r.kind === "ask_manager") {
            return (
              <Button key={r.kind} variant="primary" size={size} onClick={() => dispatch({ type: "ASK_MANAGER", item: r.item, place: r.place })}>
                <Smartphone aria-hidden className="size-4" />
                {r.label}
              </Button>
            );
          }
          return null;
        })}

      {live && state.requests.some((r) => r.answeredAt === null && decision.key === `inventory:${r.item}`) && (
        <Chip tone="brass">
          <Loader2 aria-hidden className="size-3 animate-spin" /> Waiting for the manager
        </Chip>
      )}

      {live && decision.key === "purchasing" && state.po === "approved" && !state.submission && (
        <Button variant="primary" size={size} onClick={() => dispatch({ type: "SUBMIT_PO" })}>
          <Send aria-hidden className="size-4" />
          Submit to vendor
        </Button>
      )}

      {approvable && decision.status !== "deferred" && (
        <span className="relative">
          <Button variant="ghost" size={size} aria-expanded={rejecting} onClick={() => setRejecting(!rejecting)}>
            Set aside
          </Button>
          <AnimatePresence>
            {rejecting && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.18 }}
                className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl border border-line bg-ground-2 p-2 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.9)]"
              >
                <p className="flex items-center justify-between px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-ink-lo">
                  Why?
                  <button type="button" aria-label="Close" onClick={() => setRejecting(false)} className="text-ink-lo hover:text-ink-hi">
                    <X aria-hidden className="size-3.5" />
                  </button>
                </p>
                {REJECT_REASONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setRejecting(false);
                      dispatch({ type: "REJECT", key: decision.key, reason: r.id });
                    }}
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-ink-hi first-letter:uppercase hover:bg-ground-3"
                  >
                    {r.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </span>
      )}
    </div>
  );
}

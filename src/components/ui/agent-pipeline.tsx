"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A request drawn as it moves: trigger, the stages that prepare it, the
 * agent, a fan-out to the tools it called, then the checks on the way out.
 * Every node's state is passed in. The component animates what it is told
 * and holds no state of its own, so it can only show what really happened.
 */

export type PipeStatus = "idle" | "active" | "done" | "error";

export interface PipeNode {
  id: string;
  kicker: string;
  label: string;
  sub?: string;
  status: PipeStatus;
  /** The agent node is drawn larger. */
  primary?: boolean;
}

export interface PipeBranch {
  id: string;
  label: string;
  status: PipeStatus;
  calls: number;
}

interface AgentPipelineProps {
  title: string;
  live: boolean;
  headline: string;
  lead: PipeNode[];
  branches: PipeBranch[];
  tail: PipeNode[];
  log: string[];
  stats: { label: string; value: string }[];
  footnote: ReactNode;
  className?: string;
}

const DOT: Record<PipeStatus, string> = {
  idle: "bg-line",
  active: "bg-brass-ink",
  done: "bg-verified",
  error: "bg-conflict",
};

function Connector({ from, to, axis = "x" }: { from: PipeStatus; to: PipeStatus; axis?: "x" | "y" }) {
  const live = from !== "idle" && to === "active";
  const done = from === "done" && (to === "done" || to === "error");
  return (
    <span
      aria-hidden
      data-axis={axis}
      data-live={live}
      data-done={done}
      className={cn("flow-line shrink-0", axis === "x" ? "w-5 self-center sm:w-8" : "mx-auto")}
    />
  );
}

function Row({ nodes }: { nodes: PipeNode[] }) {
  return (
    <div className="flex items-stretch justify-center">
      {nodes.map((node, i) => (
        <div key={node.id} className="flex items-stretch">
          <div className="flex items-center">
            <Node node={node} />
          </div>
          {i < nodes.length - 1 && <Connector from={node.status} to={nodes[i + 1]?.status ?? "idle"} />}
        </div>
      ))}
    </div>
  );
}

function Node({ node }: { node: PipeNode }) {
  return (
    <div
      className={cn(
        "relative min-w-0 shrink-0 rounded-xl border px-3 py-2.5 text-center transition-colors duration-300",
        node.primary ? "min-w-[7.5rem] py-3.5" : "min-w-[6.25rem]",
        node.status === "active" && "border-brass bg-brass/10 shadow-[0_0_28px_-10px_rgba(210,162,76,0.9)]",
        node.status === "done" && "border-verified/40 bg-ground-2",
        node.status === "error" && "border-conflict/60 bg-conflict/10",
        node.status === "idle" && "border-line bg-ground-2/60",
      )}
    >
      <p className={cn("font-mono text-[0.5625rem] uppercase tracking-[0.14em]", node.status === "active" ? "text-brass-ink" : "text-ink-lo")}>
        {node.kicker}
      </p>
      <p className={cn("mt-1 text-xs font-semibold", node.status === "idle" ? "text-ink-mid" : "text-ink-hi")}>{node.label}</p>
      {node.sub && <p className="mt-0.5 font-mono text-[0.5625rem] text-ink-lo">{node.sub}</p>}
      {node.status === "active" && (
        <span aria-hidden className="mt-1.5 flex justify-center gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="typing-dot size-1 rounded-full bg-brass-ink" style={{ animationDelay: `${i * 0.16}s` }} />
          ))}
        </span>
      )}
    </div>
  );
}

export function AgentPipeline({ title, live, headline, lead, branches, tail, log, stats, footnote, className }: AgentPipelineProps) {
  const lastLead = lead[lead.length - 1];
  const fanStatus: PipeStatus = branches.some((b) => b.status === "active")
    ? "active"
    : branches.some((b) => b.status === "done" || b.status === "error")
      ? "done"
      : "idle";
  const shown = log.slice(-5);

  return (
    <section className={cn("overflow-hidden rounded-2xl border border-line bg-ground-0", className)} aria-label={title}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-ink-mid">
          <span className={cn("size-1.5 rounded-full", live ? "animate-pulse bg-verified" : "bg-ink-lo")} />
          {title} · {live ? "live" : "idle"}
        </p>
        <p className="font-mono text-[0.625rem] text-ink-lo">{headline}</p>
      </header>

      {/* Three bands: the way in, the fan-out to what the agent called, the way out. */}
      <div className="space-y-2 px-4 py-6">
        <Row nodes={lead} />
        <Connector axis="y" from={lastLead?.status ?? "idle"} to={fanStatus} />

        <ul className="mx-auto grid max-w-xl grid-cols-3 gap-1.5">
          {branches.map((b) => (
            <li
              key={b.id}
              className={cn(
                "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 transition-colors duration-300",
                b.status === "active" && "border-brass bg-brass/10",
                b.status === "done" && "border-line bg-ground-2",
                b.status === "error" && "border-conflict/60 bg-conflict/10",
                b.status === "idle" && "border-line-soft bg-transparent",
              )}
            >
              <span className={cn("text-[0.6875rem] leading-tight", b.status === "idle" ? "text-ink-lo" : "text-ink-hi")}>{b.label}</span>
              <span className="flex items-center gap-1">
                {b.calls > 1 && <span className="font-mono text-[0.5625rem] text-ink-lo">×{b.calls}</span>}
                <span className={cn("size-1.5 rounded-full", DOT[b.status], b.status === "active" && "animate-pulse")} />
              </span>
            </li>
          ))}
        </ul>

        <Connector axis="y" from={fanStatus} to={tail[0]?.status ?? "idle"} />
        <Row nodes={tail} />
      </div>

      <div className="min-h-[6.5rem] border-t border-line bg-ground-1/60 px-4 py-3 font-mono text-[0.6875rem] leading-relaxed">
        <AnimatePresence initial={false}>
          {shown.map((line, i) => (
            <motion.p
              key={`${log.length - shown.length + i}:${line}`}
              layout="position"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: i === shown.length - 1 ? 1 : 0.55, y: 0 }}
              transition={{ duration: 0.2 }}
              className="truncate text-ink-mid"
            >
              <span className="text-brass-ink">›</span> {line}
            </motion.p>
          ))}
        </AnimatePresence>
        {shown.length === 0 && <p className="text-ink-lo">› waiting for a question</p>}
      </div>

      <footer className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t border-line px-4 py-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-ink-lo">{s.label}</dt>
              <dd className="mt-0.5 font-mono text-sm text-ink-hi">{s.value}</dd>
            </div>
          ))}
        </dl>
        <p className="font-mono text-[0.625rem] text-ink-lo">{footnote}</p>
      </footer>
    </section>
  );
}

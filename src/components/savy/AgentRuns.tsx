"use client";

import clsx from "clsx";
import { Eyebrow, Panel } from "../ui/primitives";
import { useSavy } from "./SavyContext";

/**
 * System view of the agent: each run, the tools it called with their inputs,
 * and the result of the grounding check. This is observable behaviour. The
 * model's reasoning is not shown and is not requested.
 */
export function AgentRuns() {
  const { turns, planner, setOpen } = useSavy();
  const runs = turns.slice().reverse();

  return (
    <Panel className="flex max-h-[60dvh] flex-col">
      <div className="border-b border-line px-4 py-3.5">
        <Eyebrow>Agent runs</Eyebrow>
        <p className="mt-1 font-mono text-xs text-ink-mid">
          planner: {planner === null ? "…" : planner.mode === "model" ? planner.model : "rules (no model key)"}
        </p>
      </div>

      <ol className="flex-1 overflow-y-auto px-2 py-2">
        {runs.map((run) => (
          <li key={run.id} className="rounded-lg px-2.5 py-2.5">
            <p className="text-xs leading-snug text-ink-hi">“{run.question}”</p>
            <p className="mt-1 font-mono text-[0.6875rem] text-ink-lo">
              {run.mode ?? "…"} · {run.status}
              {run.ms !== null && ` · ${run.ms} ms`}
              {run.usage && ` · ${run.usage.input}/${run.usage.output} tok`}
              {run.stopReason && ` · ${run.stopReason}`}
            </p>
            <ol className="mt-1.5 space-y-1 font-mono text-[0.6875rem]">
              {run.steps.map((step) => (
                <li key={step.id} className={clsx("break-all", step.isError ? "text-conflict" : "text-ink-mid")}>
                  <span className="text-brass-ink">{step.name}</span>
                  {JSON.stringify(step.input)}
                  <span className="text-ink-lo"> → {step.summary ?? "running"}</span>
                </li>
              ))}
            </ol>
            {run.proposals.map((p) => (
              <p key={p.id} className="mt-1 font-mono text-[0.6875rem] text-ink-mid">
                proposal {p.action.kind} · {p.confirmed ? "confirmed by a person" : "waiting for a person"}
              </p>
            ))}
            {run.grounding && (
              <p
                className={clsx(
                  "mt-1 font-mono text-[0.6875rem]",
                  run.grounding.ungrounded.length + run.grounding.unknownCitations.length === 0 ? "text-verified" : "text-conflict",
                )}
              >
                grounding: {run.grounding.figures} figures · {run.grounding.ungrounded.length} ungrounded ·{" "}
                {run.grounding.citations.length} citations · {run.grounding.unknownCitations.length} unknown
              </p>
            )}
          </li>
        ))}
        {runs.length === 0 && (
          <li className="px-2.5 py-3 text-xs leading-relaxed text-ink-lo">
            No runs yet.{" "}
            <button type="button" onClick={() => setOpen(true)} className="text-brass-ink underline-offset-4 hover:underline">
              Ask Savy something
            </button>{" "}
            and its tool calls appear here.
          </li>
        )}
      </ol>
    </Panel>
  );
}

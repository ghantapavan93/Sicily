"use client";

import { useMemo } from "react";
import { VENUE } from "@/domain/venue";
import { AgentPipeline, type PipeNode } from "../ui/agent-pipeline";
import { MorphOrb } from "../ui/morph-orb";
import { Eyebrow, Panel } from "../ui/primitives";
import { SessionPanel } from "../engineering/SessionPanel";
import { AgentRuns } from "./AgentRuns";
import { SavyConversation } from "./SavyConversation";
import { useSavy } from "./SavyContext";
import { pipelineOf, statsOf } from "./trace";

const HOW_IT_WORKS: { title: string; body: string }[] = [
  {
    title: "It reads what you see",
    body: "The browser sends the list of things you did. The server replays them through the same engine, so Savy can't be handed a state the engine wouldn't produce.",
  },
  {
    title: "It never owns a number",
    body: "Loads, wages, orders and cash come from the restaurant twin through tools. After each answer, every figure is looked up in what the tools returned.",
  },
  {
    title: "It asks. You act.",
    body: "Savy can put a button in front of you. Nothing changes until you press it, and the engine refuses a proposal the evidence doesn't support.",
  },
];

/**
 * ASK. The conversation at full size, with the machinery beside it: each
 * question is drawn moving through state replay, the agent, the systems it
 * read and the checks on the way out.
 */
export function AskChapter() {
  const { turns, planner, orb } = useSavy();
  const current = turns[turns.length - 1] ?? null;
  const view = useMemo(() => pipelineOf(current), [current]);
  const stats = useMemo(() => statsOf(turns), [turns]);

  const lead: PipeNode[] = [
    { id: "question", kicker: "Trigger", label: "Your question", status: view.nodes.question },
    { id: "replay", kicker: "State", label: "Replay", sub: current?.replay ? `${current.replay.actions} actions` : "reducer", status: view.nodes.replay },
    {
      id: "agent",
      kicker: "Agent",
      label: view.nodes.agent === "active" ? "Processing" : "Savy",
      sub: planner?.mode === "model" ? (planner.model ?? "claude") : "sample-data rules",
      status: view.nodes.agent,
      primary: true,
    },
  ];
  const tail: PipeNode[] = [
    { id: "check", kicker: "Check", label: "Grounding", sub: current?.grounding ? `${current.grounding.figures} figures` : "every figure", status: view.nodes.check },
    { id: "answer", kicker: "Out", label: "Answer", sub: current?.proposals.length ? "with a proposal" : "to you", status: view.nodes.answer },
  ];

  return (
    <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-6 sm:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section
        aria-label="Conversation with Savy"
        className="glass relative flex h-[calc(100dvh-8.5rem)] min-h-[34rem] flex-col overflow-hidden rounded-3xl border border-line xl:sticky xl:top-[5.5rem]"
      >
        <div aria-hidden className="aurora pointer-events-none absolute inset-0" />
        <header className="relative flex items-center gap-3 border-b border-line/70 px-5 py-4 sm:px-8">
          <MorphOrb size={30} state={orb} />
          <div>
            <p className="font-display text-xl leading-none text-ink-hi">Savy</p>
            <p className="mt-1.5 text-[0.6875rem] leading-none text-ink-lo">
              {VENUE.name} · {planner?.mode === "model" ? planner.model : "sample-data demo"} · drafts and explains; you decide
            </p>
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <SavyConversation variant="page" autoFocus />
        </div>
      </section>

      <aside aria-label="How Savy answered" className="min-w-0 space-y-5">
        <div>
          <Eyebrow>Agent pipeline</Eyebrow>
          <h1 className="mt-2 font-display text-3xl font-light leading-tight text-ink-hi sm:text-4xl">
            Watch the question travel.
          </h1>
          <p className="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-ink-mid">
            Every question goes through the same path. Each box lights when the server reports it happened, and stays
            dark when it didn't.
          </p>
        </div>

        <AgentPipeline
          title="Savy pipeline"
          live={view.live}
          headline={`${stats.runs} ${stats.runs === 1 ? "run" : "runs"} · ${stats.ungrounded} ungrounded`}
          lead={lead}
          branches={view.branches}
          tail={tail}
          log={view.log}
          stats={[
            { label: "Runs", value: String(stats.runs) },
            { label: "Tool calls", value: String(stats.toolCalls) },
            { label: "Avg latency", value: stats.avgMs === null ? "—" : `${stats.avgMs} ms` },
            { label: "Figures checked", value: String(stats.figures) },
            { label: "Proposals", value: `${stats.confirmed}/${stats.proposals} confirmed` },
          ]}
          footnote={planner?.mode === "model" ? `stack · ${planner.model} · tool use` : "stack · rules planner · same tools"}
        />

        <ul className="grid gap-3 sm:grid-cols-3">
          {HOW_IT_WORKS.map((item) => (
            <li key={item.title}>
              <Panel className="h-full p-4">
                <p className="text-sm font-semibold text-ink-hi">{item.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-mid">{item.body}</p>
              </Panel>
            </li>
          ))}
        </ul>

        <div className="grid gap-5 lg:grid-cols-2">
          <AgentRuns />
          <SessionPanel />
        </div>
      </aside>
    </div>
  );
}

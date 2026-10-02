"use client";

import clsx from "clsx";
import { formatClock } from "@/domain/clock";
import { SERVICES, SITUATIONS } from "@/shadow/history";
import { agreementOf, classify, CLASSIFICATION_RULE, SURFACE_MIN_USD, wouldSurface } from "@/shadow/replay";
import { Eyebrow, Panel } from "../ui/primitives";

const RULES: { name: string; rule: string }[] = [
  { name: "replay.visible", rule: "event.availableAt <= replayClock. The same filter the live engine uses." },
  { name: "record_lag", rule: "A staff action taken before detection reaches a system later, so it is excluded at detection time." },
  { name: "classify.already_handled", rule: CLASSIFICATION_RULE.already_handled },
  { name: "classify.noise", rule: CLASSIFICATION_RULE.noise },
  { name: "classify.useful", rule: CLASSIFICATION_RULE.useful },
  { name: "surface", rule: `Owner-level kind and impact >= $${SURFACE_MIN_USD}. Otherwise it routes to the manager's list.` },
  { name: "agreement", rule: "For surfaced rows only: operator.action equals the action Savy would have recommended." },
];

/** System view of the evaluation: the rules, then every row they were applied to. */
export function ShadowRules({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="space-y-5">
      <Panel className="p-5 sm:p-7">
        <Eyebrow>Evaluation rules</Eyebrow>
        <p className="mt-1.5 text-sm text-ink-mid">
          The summary above is these rules applied to the rows below. Nothing is typed in.
        </p>
        <dl className="mt-4 divide-y divide-line-soft font-mono text-xs">
          {RULES.map((r) => (
            <div key={r.name} className="grid gap-1 py-2.5 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <dt className="text-brass-ink">{r.name}</dt>
              <dd className="font-sans text-sm leading-snug text-ink-mid">{r.rule}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <Eyebrow>All {SITUATIONS.length} situations</Eyebrow>
        </div>
        <div className="max-h-[60dvh] overflow-auto">
          <table className="w-full min-w-[820px] text-left font-mono text-xs">
            <thead className="sticky top-0 bg-ground-1 text-ink-lo">
              <tr className="border-b border-line">
                {["id", "service", "detected", "impact", "operator", "acted", "materialized", "class", "surfaced", "agreement"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SITUATIONS.map((s) => {
                const c = classify(s);
                const agreement = agreementOf(s);
                return (
                  <tr key={s.id} className="border-b border-line-soft last:border-0 hover:bg-ground-2">
                    <td className="px-4 py-2">
                      <button type="button" onClick={() => onOpen(s.id)} className="text-brass-ink underline-offset-4 hover:underline">
                        {s.id}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-ink-mid">{SERVICES.find((d) => d.index === s.service)?.label}</td>
                    <td className="px-4 py-2 text-ink-mid">{formatClock(s.detectedAt)}</td>
                    <td className="px-4 py-2 text-ink-mid">${s.impactUsd}</td>
                    <td className="px-4 py-2 text-ink-mid">{s.operator.action}</td>
                    <td className="px-4 py-2 text-ink-mid">{s.operator.at === null ? "—" : formatClock(s.operator.at)}</td>
                    <td className="px-4 py-2 text-ink-mid">{String(s.result.materialized)}</td>
                    <td
                      className={clsx(
                        "px-4 py-2",
                        c === "useful" ? "text-ink-hi" : c === "already_handled" ? "text-planned" : "text-unknown",
                      )}
                    >
                      {c}
                    </td>
                    <td className={clsx("px-4 py-2", wouldSurface(s) ? "text-brass-ink" : "text-ink-lo")}>{String(wouldSurface(s))}</td>
                    <td className={clsx("px-4 py-2", agreement === "disagree" ? "text-conflict" : agreement === "agree" ? "text-verified" : "text-ink-lo")}>
                      {agreement ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

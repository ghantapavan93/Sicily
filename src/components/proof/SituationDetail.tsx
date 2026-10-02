"use client";

import { Lock, X } from "lucide-react";
import { useMemo } from "react";
import { formatClock } from "@/domain/clock";
import { SERVICES } from "@/shadow/history";
import {
  agreementOf,
  CLASSIFICATION_RULE,
  classify,
  detectedOf,
  isOwnerLevel,
  kindLabel,
  knowableFor,
  missingOf,
  OPERATOR_LABEL,
  recommendationOf,
  SURFACE_MIN_USD,
  titleOf,
  wouldSurface,
} from "@/shadow/replay";
import type { Situation } from "@/shadow/types";
import { BasisBadge } from "../ui/badges";
import { Button, Chip, Eyebrow, Panel } from "../ui/primitives";
import { AGREEMENT, CLASS } from "./tones";

/** The sentence that explains, from the record's own timestamps, why it was classified this way. */
function classificationFacts(s: Situation): string {
  const c = classify(s);
  if (c === "already_handled" && s.operator.at !== null) {
    return `The operator acted at ${formatClock(s.operator.at)}. Savy's detection time was ${formatClock(s.detectedAt)}.`;
  }
  if (c === "noise") {
    return s.operator.action === "none"
      ? "Nobody acted, and the risk did not materialize."
      : `The operator chose "${OPERATOR_LABEL[s.operator.action].toLowerCase()}", and the risk did not materialize.`;
  }
  return s.operator.at !== null
    ? `The operator acted at ${formatClock(s.operator.at)}, after Savy's detection time of ${formatClock(s.detectedAt)}.`
    : "Nobody acted, and the risk was real.";
}

function routeOf(s: Situation): string {
  if (wouldSurface(s)) {
    return `Would have reached the owner: about $${s.impactUsd} at stake, at or above the $${SURFACE_MIN_USD} line.`;
  }
  return isOwnerLevel(s)
    ? `Would have stayed on the manager's list: about $${s.impactUsd} at stake, below the $${SURFACE_MIN_USD} line.`
    : "Would have gone to the manager's list. This kind of situation is not an owner decision.";
}

/**
 * One past situation, opened. The replay clock is pinned to the moment Savy
 * would have noticed it, and everything that arrived later is shown apart.
 */
export function SituationDetail({ situation, onClose }: { situation: Situation; onClose: () => void }) {
  const { knowable, arrivedLater } = useMemo(() => knowableFor(situation), [situation]);
  const day = SERVICES.find((d) => d.index === situation.service);
  const c = classify(situation);
  const agreement = agreementOf(situation);

  return (
    <Panel className="overflow-hidden border-brass/40">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5 sm:p-7">
        <div>
          <Eyebrow>
            {kindLabel(situation)} · {day?.label} · {situation.id}
          </Eyebrow>
          <h3 className="mt-2 font-display text-2xl font-light leading-snug text-ink-hi sm:text-3xl">{titleOf(situation)}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip tone={CLASS[c].tone}>{CLASS[c].label}</Chip>
            {agreement && <Chip tone={AGREEMENT[agreement].tone}>{AGREEMENT[agreement].label}</Chip>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close this situation">
          <X aria-hidden className="size-4" />
          Close
        </Button>
      </div>

      <div className="border-b border-line bg-ground-2/50 px-5 py-3.5 sm:px-7">
        <p className="text-sm text-ink-hi">
          Replay clock: <span className="font-mono text-brass-ink">{formatClock(situation.detectedAt)}</span>
          <span className="text-ink-mid"> · Only evidence available by this timestamp is included.</span>
        </p>
      </div>

      <div className="grid gap-px bg-line md:grid-cols-2">
        <div className="bg-ground-1 p-5 sm:p-6">
          <Eyebrow>Knowable at {formatClock(situation.detectedAt)}</Eyebrow>
          <ul className="mt-3 space-y-3">
            {knowable.map((e) => (
              <li key={e.id}>
                <p className="flex items-center justify-between gap-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-mid">
                  <span>{e.source}</span>
                  <time className="font-mono font-normal tracking-normal text-ink-lo">{formatClock(e.availableAt)}</time>
                </p>
                <p className="mt-1 text-sm leading-snug text-ink-hi">{e.text}</p>
                <div className="mt-1.5">
                  <BasisBadge basis={e.basis} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-ground-1 p-5 sm:p-6">
          <Eyebrow>Arrived later · excluded</Eyebrow>
          <ul className="mt-3 space-y-3">
            {arrivedLater.map((e) => (
              <li key={e.id} className="flex gap-3 opacity-75">
                <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-lo" />
                <div>
                  <p className="flex flex-wrap items-center gap-x-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-lo">
                    <span>{e.source}</span>
                    <time className="font-mono font-normal tracking-normal">reached a system {formatClock(e.availableAt)}</time>
                  </p>
                  <p className="mt-1 text-sm leading-snug text-ink-mid">{e.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-x-8 gap-y-6 border-t border-line p-5 sm:grid-cols-2 sm:p-7">
        <div>
          <Eyebrow>What Savy would have said</Eyebrow>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-hi">{detectedOf(situation)}</p>
          <p className="mt-2 text-[0.9375rem] font-semibold leading-relaxed text-ink-hi">{recommendationOf(situation)}</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-lo">{routeOf(situation)}</p>
        </div>
        <div>
          <Eyebrow>What Savy could not see</Eyebrow>
          <ul className="mt-2 space-y-1.5">
            {missingOf(situation).map((line) => (
              <li key={line} className="text-[0.9375rem] leading-relaxed text-ink-mid">
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Eyebrow>What the operator did</Eyebrow>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-hi">
            {OPERATOR_LABEL[situation.operator.action]}
            {situation.operator.at !== null && ` at ${formatClock(situation.operator.at)}`}.
          </p>
          {situation.operator.reason && (
            <p className="mt-2 border-l-2 border-brass/60 pl-3 text-[0.9375rem] leading-relaxed text-ink-mid">
              “{situation.operator.reason}”
            </p>
          )}
        </div>
        <div>
          <Eyebrow>What happened</Eyebrow>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-hi">{situation.result.note}</p>
        </div>
      </div>

      <div className="border-t border-line bg-ground-2/50 px-5 py-4 sm:px-7">
        <Eyebrow>Why it is classified {CLASS[c].label.toLowerCase()}</Eyebrow>
        <p className="mt-2 text-sm leading-relaxed text-ink-mid">
          {classificationFacts(situation)} Rule: {CLASSIFICATION_RULE[c]}
        </p>
      </div>
    </Panel>
  );
}

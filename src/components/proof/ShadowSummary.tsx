"use client";

import { useMemo } from "react";
import { CLASSIFICATION_RULE, summarize, SURFACE_MIN_USD } from "@/shadow/replay";
import { Chip, Eyebrow, Panel } from "../ui/primitives";

function Stat({ figure, label, hint }: { figure: number; label: string; hint?: string }) {
  return (
    <div title={hint}>
      <p className="font-display text-4xl font-light leading-none text-ink-hi sm:text-5xl">{figure}</p>
      <p className="mt-2 text-sm leading-snug text-ink-mid">{label}</p>
    </div>
  );
}

/** Every figure here is counted from the rows below it. Hover a figure for the rule that produced it. */
export function ShadowSummary() {
  const s = useMemo(() => summarize(), []);
  const share = (n: number) => `${(n / s.detected) * 100}%`;

  return (
    <Panel className="p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Savy Shadow · last {s.services} services</Eyebrow>
        <Chip tone="neutral" title="These rows are synthetic. They show how the evaluation works, not a measured result.">
          Synthetic prototype data
        </Chip>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end">
        <Stat figure={s.detected} label="situations Savy would have detected" />

        <div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`${s.useful} likely useful, ${s.alreadyHandled} already handled by staff, ${s.noise} likely noise`}>
            <span className="bg-ink-hi" style={{ width: share(s.useful) }} />
            <span className="bg-planned" style={{ width: share(s.alreadyHandled) }} />
            <span className="bg-unknown/60" style={{ width: share(s.noise) }} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <Stat figure={s.useful} label="likely useful" hint={CLASSIFICATION_RULE.useful} />
            <Stat figure={s.alreadyHandled} label="already handled by staff" hint={CLASSIFICATION_RULE.already_handled} />
            <Stat figure={s.noise} label="likely noise" hint={CLASSIFICATION_RULE.noise} />
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 border-t border-line pt-6 sm:grid-cols-3">
        <Stat
          figure={s.surfaced}
          label="recommendations would have reached the owner"
          hint={`Owner-level situations with at least $${SURFACE_MIN_USD} at stake. The rest would go to the manager's list.`}
        />
        <Stat figure={s.agree} label="match what the operator actually did" hint="The operator took the action Savy would have recommended." />
        <Stat
          figure={s.disagree}
          label={`disagreements. ${s.surfacedNoise} of the ${s.surfaced} would have been noise.`}
          hint="The operator did something else. Each disagreement is kept with its reason."
        />
      </div>
    </Panel>
  );
}

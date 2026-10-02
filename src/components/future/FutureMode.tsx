"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { Check, Lock } from "lucide-react";
import { VENUE } from "@/domain/venue";
import { Chip, Eyebrow, Panel } from "../ui/primitives";

const STAGES: { title: string; says: string; unlocks: string; here: "shown" | "partly" | "exploration" }[] = [
  { title: "Dashboard", says: "Tell me what happened.", unlocks: "Numbers after the fact, one system at a time.", here: "shown" },
  { title: "Connected operating picture", says: "Show me tonight in one place.", unlocks: "One twin across POS, time and payroll, supplier email, inventory and the bank.", here: "shown" },
  { title: "Decision intelligence", says: "Tell me what needs my attention.", unlocks: "Three decisions instead of six dashboards, each with evidence, unknowns and a do-nothing branch.", here: "shown" },
  { title: "Supervised agent", says: "Prepare the action and wait for me.", unlocks: "Drafted shifts, orders and credit requests behind a permission envelope. A person sends.", here: "shown" },
  { title: "Restaurant memory", says: "Tell me what this restaurant has learned after 400 Friday nights.", unlocks: "Patterns from outcomes, co-created with the owner, that decay when the restaurant changes.", here: "partly" },
  { title: "Multi-location intelligence", says: "What's working at one location that another should try?", unlocks: "Practices that travel between locations, with each location's context kept separate.", here: "exploration" },
];

const LOCATIONS = [
  { name: `${VENUE.name} · Downtown`, line: "Friday peak 17.8 per server. Tickets stretch past 15 minutes.", tone: "brass" as const },
  { name: `${VENUE.name} · Harbor`, line: "Same demand shape. A runner from 7 to 8 holds 16.2 per server with tickets at 12 minutes.", tone: "verified" as const },
  { name: `${VENUE.name} · Midtown`, line: "Burrata waste 14% on Tuesdays. Harbor orders Tuesday's in two drops and wastes 4%.", tone: "neutral" as const },
];

/**
 * SAVY TOMORROW. A marked product exploration, not a roadmap and not a claim
 * about OPSAVOR's plans: the path from intelligence to supervised operations,
 * and what each step would let an owner stop doing.
 */
export function FutureMode() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-14 px-4 py-10 sm:px-6">
      <header className="max-w-4xl">
        <div className="flex flex-wrap items-center gap-2">
          <Eyebrow>Savy Tomorrow</Eyebrow>
          <Chip tone="neutral" dashed>
            Product exploration · not OPSAVOR&apos;s roadmap
          </Chip>
        </div>
        <h1 className="mt-4 font-display text-[clamp(2.2rem,5vw,4.25rem)] font-light leading-[1.02] tracking-[-0.015em] text-ink-hi">
          The owner stops being the integration layer, without giving up being the owner.
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-mid">
          Not &ldquo;AI runs the restaurant.&rdquo; A path where each step takes one job off the owner and leaves every decision that matters with a person.
        </p>
      </header>

      <section aria-label="The path">
        <ol className="relative space-y-3 before:absolute before:bottom-6 before:left-[1.15rem] before:top-6 before:w-px before:bg-line">
          {STAGES.map((s, i) => (
            <motion.li
              key={s.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 + i * 0.08 }}
              className="relative grid gap-4 pl-12 md:grid-cols-[16rem_minmax(0,1fr)_minmax(10rem,auto)] md:items-center"
            >
              <span
                className={clsx(
                  "absolute left-0 top-1 flex size-[2.3rem] items-center justify-center rounded-full border font-mono text-xs",
                  s.here === "shown" ? "border-brass/60 bg-brass/10 text-brass-ink" : s.here === "partly" ? "border-brass/40 text-ink-mid" : "border-dashed border-line text-ink-lo",
                )}
              >
                {i + 1}
              </span>
              <div>
                <p className="font-semibold text-ink-hi">{s.title}</p>
                <p className="mt-0.5 font-display text-lg font-light italic text-ink-mid">&ldquo;{s.says}&rdquo;</p>
              </div>
              <p className="text-[0.9375rem] leading-relaxed text-ink-mid">{s.unlocks}</p>
              <span className="md:text-right">
                {s.here === "shown" ? (
                  <Chip tone="brass">
                    <Check aria-hidden className="size-3" /> In this prototype
                  </Chip>
                ) : s.here === "partly" ? (
                  <Chip tone="neutral">Partly, on sample history</Chip>
                ) : (
                  <Chip tone="neutral" dashed>
                    Exploration
                  </Chip>
                )}
              </span>
            </motion.li>
          ))}
        </ol>
      </section>

      <section aria-label="Trusted workflows" className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div>
          <Eyebrow>Trusted workflows</Eyebrow>
          <h2 className="mt-2 font-display text-3xl font-light text-ink-hi">&ldquo;Execute approved classes of actions inside explicit limits.&rdquo;</h2>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-mid">
            The step this prototype stops before. It would only ever be granted per class of action, by the owner, with the envelope written down
            and every execution leaving a receipt. Here is what one envelope could look like.
          </p>
        </div>
        <Panel className="p-5">
          <p className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-lo">
            <Lock aria-hidden className="size-3.5" /> Policy envelope · not active
          </p>
          <pre className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed text-ink-mid">{`class: reorder_par_item
granted_by: owner
may:
  - reorder items on the standing list to par
  - from contracted vendors, at contract price
limits:
  max_per_order: $150
  max_per_week:  $600
never:
  - on a disputed or missing count
  - on a stale inventory reading
  - when a vendor status is unknown
every_execution:
  receipt: true
  owner_can_reverse_within: 2h`}</pre>
        </Panel>
      </section>

      <section aria-label="Many locations">
        <Eyebrow>Institutional intelligence</Eyebrow>
        <h2 className="mt-2 max-w-3xl font-display text-3xl font-light text-ink-hi">One restaurant teaches the others, without becoming the others.</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {LOCATIONS.map((l) => (
            <Panel key={l.name} className="p-5">
              <p className="font-semibold text-ink-hi">{l.name}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-mid">{l.line}</p>
            </Panel>
          ))}
        </div>
        <p className="mt-4 max-w-3xl rounded-2xl border border-brass/40 bg-brass/[0.05] px-5 py-4 text-[0.9375rem] leading-relaxed text-ink-hi">
          &ldquo;Downtown may benefit from Harbor&apos;s 7 PM runner. Same demand shape, same menu. Harbor&apos;s floor is smaller, so the evidence is
          suggestive, not proof.&rdquo;
          <span className="mt-1 block text-xs text-ink-lo">Synthetic locations. An illustration of the idea, not a feature of this prototype.</span>
        </p>
      </section>

      <footer className="border-t border-line pt-12">
        <p className="max-w-4xl font-display text-[clamp(1.8rem,3.6vw,3rem)] font-light leading-[1.15] text-ink-hi">
          Today, restaurant software records what happened. Savy should understand what is happening, what might happen next, and what the
          operator learned when the night was over.
        </p>
      </footer>
    </div>
  );
}

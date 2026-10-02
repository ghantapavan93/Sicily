"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { useTwin } from "../experience/TwinContext";
import { ProofChapter } from "../proof/ProofChapter";
import { Button, Eyebrow } from "../ui/primitives";
import { FaultBoard } from "./PressurePanel";
import { StressLab } from "./StressLab";

type Tab = "pressure" | "lab" | "shadow";
const TABS: { id: Tab; label: string }[] = [
  { id: "pressure", label: "Pressure test" },
  { id: "lab", label: "Every combination" },
  { id: "shadow", label: "The last 30 services" },
];

/**
 * LAB. Prove it fails safely: break tonight's data one fault at a time, run
 * every combination on every night, and replay the last thirty services
 * with the future locked out.
 */
export function LabMode() {
  const { state, openNight, focusedSituation } = useTwin();
  const [tab, setTab] = useState<Tab>(focusedSituation ? "shadow" : "pressure");

  useEffect(() => {
    if (focusedSituation) setTab("shadow");
  }, [focusedSituation]);

  return (
    <div className="mx-auto max-w-[1300px] space-y-6 px-4 py-8 sm:px-6">
      <header className="max-w-3xl">
        <Eyebrow>Failure lab</Eyebrow>
        <h1 className="mt-3 font-display text-[clamp(2rem,4.4vw,3.5rem)] font-light leading-[1.05] tracking-[-0.01em] text-ink-hi">
          When Savy knows less, Savy does less.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-mid">
          Restaurant data breaks every night. A sync stalls, a vendor times out, two systems disagree, an email arrives twice. Each failure below
          teaches one principle, and every one of them is checked, not promised.
        </p>
      </header>

      <div role="tablist" aria-label="Lab" className="flex w-fit flex-wrap rounded-full border border-line bg-ground-1 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx("rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] transition-colors", tab === t.id ? "bg-ground-3 text-ink-hi" : "text-ink-lo hover:text-ink-mid")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pressure" &&
        (state.phase === "idle" ? (
          <div className="rounded-2xl border border-dashed border-line p-6">
            <p className="text-ink-mid">The pressure test runs on tonight&apos;s live twin. Open a night first.</p>
            <Button variant="primary" className="mt-4" onClick={() => openNight("friday_rush")}>
              Open Friday
            </Button>
          </div>
        ) : (
          <FaultBoard />
        ))}
      {tab === "lab" && <StressLab />}
      {tab === "shadow" && <ProofChapter />}
    </div>
  );
}

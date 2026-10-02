"use client";

import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Minutes } from "@/domain/clock";
import { VENUE } from "@/domain/venue";
import { FEATURED_SERVICE, REPLAY_WINDOW } from "@/shadow/history";
import { findSituation, situationsOf } from "@/shadow/replay";
import { useTwin } from "../experience/TwinContext";
import { Eyebrow } from "../ui/primitives";
import { ReplayPanel } from "./ReplayPanel";
import { ServiceTimeline } from "./ServiceTimeline";
import { ShadowRules } from "./ShadowRules";
import { ShadowSummary } from "./ShadowSummary";
import { SituationDetail } from "./SituationDetail";

/** Replay speed: restaurant minutes per tick, and the tick length. */
const REPLAY_STEP_MIN = 6;
const REPLAY_TICK_MS = 110;

/** A service opens with the clock on its first detection, so the locked half is never empty. */
const openingClock = (service: number): Minutes => situationsOf(service)[0]?.detectedAt ?? REPLAY_WINDOW.opens;

/**
 * Savy Shadow. Before Savy is allowed to influence tonight, replay what it
 * would have done across the last thirty services, with the future locked out.
 */
export function ProofChapter() {
  const { view, focusedSituation, openSituation } = useTwin();
  const reducedMotion = useReducedMotion();

  const focused = focusedSituation ? findSituation(focusedSituation) : undefined;
  const [service, setService] = useState(focused?.service ?? FEATURED_SERVICE);
  const [clock, setClock] = useState<Minutes>(focused?.detectedAt ?? openingClock(focused?.service ?? FEATURED_SERVICE));
  const [playing, setPlaying] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  // A situation opened from memory or from the rules table moves the replay to it.
  useEffect(() => {
    if (!focused) return;
    setService(focused.service);
    setClock(focused.detectedAt);
    setPlaying(false);
    detailRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }, [focused, reducedMotion]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setClock((c) => Math.min(REPLAY_WINDOW.closes, c + REPLAY_STEP_MIN));
    }, REPLAY_TICK_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  // The replay stops itself at close.
  useEffect(() => {
    if (playing && clock >= REPLAY_WINDOW.closes) setPlaying(false);
  }, [playing, clock]);

  const selectService = useCallback(
    (next: number) => {
      setService(next);
      setClock(openingClock(next));
      setPlaying(false);
      openSituation(null);
    },
    [openSituation],
  );

  const togglePlay = () => {
    // Starting a replay from the end rewinds it.
    if (!playing && clock >= REPLAY_WINDOW.closes) setClock(REPLAY_WINDOW.opens);
    setPlaying(!playing);
  };

  return (
    <div className="space-y-5">
      <header className="max-w-3xl">
        <Eyebrow>Savy Shadow</Eyebrow>
        <h2 className="mt-2 font-display text-3xl font-light leading-tight text-ink-hi">Prove the decision before you automate it.</h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-mid">
          What Savy would have noticed during {VENUE.name}&apos;s previous 30 services. It could recommend. It could not act. At every moment it
          knew only what had arrived by then.
        </p>
      </header>
      <ShadowSummary />
      <ServiceTimeline selected={service} onSelect={selectService} />
      <ReplayPanel
        service={service}
        clock={clock}
        playing={playing}
        onClock={(c) => {
          setPlaying(false);
          setClock(c);
        }}
        onTogglePlay={togglePlay}
        onOpenSituation={openSituation}
      />
      <div ref={detailRef} className="scroll-mt-28">
        {focused && <SituationDetail situation={focused} onClose={() => openSituation(null)} />}
      </div>
      {view === "engineering" && <ShadowRules onOpen={openSituation} />}
    </div>
  );
}

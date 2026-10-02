"use client";

import { useTwin } from "../experience/TwinContext";
import { PeakFloor } from "../floor/PeakFloor";
import { CloseOut } from "./CloseOut";
import { DecisionQueue } from "./DecisionQueue";
import { EngineGraph } from "./EngineGraph";
import { IncomingLedger } from "./IncomingLedger";
import { PulseStrip } from "./PulseStrip";
import { Surfaces } from "./Surfaces";

/**
 * LIVE. One restaurant night. What arrived on the left, Savy and the
 * decisions in the middle, the operating surfaces on the right: every one of
 * them a projection of the same twin.
 */
export function LiveMode() {
  const { state } = useTwin();
  const closed = state.phase === "closed" || state.phase === "remembered";

  return (
    <>
      <PulseStrip />
      <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-6 sm:px-6 xl:grid-cols-[17.5rem_minmax(0,1fr)_23rem]">
        <aside aria-label="Incoming signals" className="order-2 xl:order-none">
          <IncomingLedger />
        </aside>
        <section aria-label="Savy and tonight's decisions" className="order-1 min-w-0 space-y-6 xl:order-none">
          {closed ? <CloseOut /> : <EngineGraph />}
          {state.phase === "live" && <PeakFloor />}
          {!closed && <DecisionQueue />}
          {state.phase === "live" && <CloseOut />}
        </section>
        <aside aria-label="Operating surfaces" className="order-3 xl:order-none">
          <Surfaces />
        </aside>
      </div>
    </>
  );
}

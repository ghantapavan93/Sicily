import { chosenChoices, simulate } from "./consequence";
import { floorAt } from "./floor";
import { clock, one, signedUsd, usd } from "./format";
import { memoriesFor } from "./recall";
import { evaluate, type TwinState } from "./runtime";

/*
 * Two documents Savy drafts from the twin, for two different people at two
 * different moments. Neither is sent anywhere: a person reads it out or
 * forwards it.
 */

export interface Lineup {
  title: string;
  at: string;
  covers: string;
  sections: { section: string; who: string; note: string; over: boolean }[];
  stock: string[];
  watch: string[];
  calls: string[];
}

/** The pre-shift huddle, written for the floor. Built from what has been decided, not from what Savy recommends. */
export function lineupOf(state: TwinState): Lineup | null {
  const e = evaluate(state);
  const t = e.twin;
  const booked = t.demand.booked?.value;
  if (booked === undefined || t.demand.peakCovers === null) return null;
  const choices = chosenChoices(t, e.decisions);
  const run = simulate(e.scenario, t, choices, "chosen", "Tonight as decided");
  const peak = run?.points.reduce((a, b) => (b.load > a.load ? b : a));
  const floor = run && peak ? floorAt(t, choices, peak) : null;

  const sections = (floor?.sections ?? []).map((sec) => {
    const own = floor?.servers.find((s) => s.name === sec.server);
    const who = sec.server ?? (sec.coveredBy.length ? `${sec.coveredBy.join(" and ")} split it` : "Nobody");
    const load = own?.load ?? floor?.servers.find((s) => sec.coveredBy.includes(s.name))?.load ?? 0;
    return {
      section: `${sec.id} · ${sec.name}`,
      who,
      note: own?.added ? `On call, ${clock(t.staffing.added[0]?.start ?? 0)} to ${clock(t.staffing.added[0]?.end ?? 0)}` : sec.server ? `${one(load)} covers an hour at ${clock(peak!.at)}` : "No server of its own tonight",
      over: load > t.staffing.ceiling,
    };
  });

  const stock = t.inventory.map((i) => {
    if (i.status === "ok") return `${i.name}: covered. ${i.line?.value ?? 0} on the line${i.backup ? `, ${i.backup.value} in the walk-in` : ""}.`;
    if (i.runOutAt) return `${i.name}: likely out around ${clock(i.runOutAt)}. Steer late tables to the special.`;
    if (i.status === "needs_backup_count") return `${i.name}: walk-in not counted yet. Count it before doors.`;
    if (i.status === "needs_count" || i.status === "discrepancy") return `${i.name}: count needed before doors.`;
    if (i.status === "surplus") return `${i.name}: plenty. Feature it.`;
    return `${i.name}: ${i.status.replace(/_/g, " ")}.`;
  });

  const watch: string[] = [];
  if (t.demand.nearbyEvent) watch.push(`${t.demand.nearbyEvent.value.name} ends ${clock(t.demand.nearbyEvent.value.endsAt)}. Late walk-ins are possible; keep a section ready.`);
  for (const d of t.deliveries.filter((x) => x.short > 0)) watch.push(`${d.name} came in short. Hold the salad at ${t.inventory.find((i) => i.item === d.item)?.line?.value ?? "—"} portions, then arugula.`);
  if (t.ledger.stale.length) watch.push(`${t.ledger.stale.map((s) => s.claim).join(", ")} is stale. Savy is holding anything that depends on it.`);

  const calls: string[] = [];
  if (peak) {
    calls.push(
      peak.ticketMinutes > 12
        ? `Peak is ${clock(peak.at)}: ${peak.covers} covers in that half hour. Expect tickets near ${peak.ticketMinutes} minutes as things stand.`
        : `Peak is ${clock(peak.at)}: ${peak.covers} covers in that half hour. Tickets should hold at ${peak.ticketMinutes} minutes; tell the owner if they pass 15.`,
    );
  }
  const staff = e.decisions.find((d) => d.key === "staffing");
  if (staff?.status === "recommend") calls.push(`Not decided yet: ${staff.recommendation?.action}. Until then, plan for ${t.staffing.servers} on the floor.`);
  if (staff?.status === "rejected") calls.push("The added server was not approved. Split the empty section as above.");

  return {
    title: `${e.scenario.service} · lineup`,
    at: clock(Math.min(e.scenario.doorsAt - 10, Math.max(state.processedThrough, e.scenario.decideAt))),
    covers: `${booked} booked (${t.demand.vsPlanPct !== null && t.demand.vsPlanPct >= 0 ? "+" : ""}${Math.round(t.demand.vsPlanPct ?? 0)}% on plan) · about ${t.demand.peakCovers} in the 7 PM hour`,
    sections,
    stock,
    watch,
    calls,
  };
}

export interface MondayBriefing {
  title: string;
  ready: boolean;
  night: string[];
  decided: { id: string; line: string }[];
  agenda: { title: string; why: string }[];
  learned: string[];
  cash: string;
}

/**
 * The Monday briefing, drafted when the night closes. Everything Savy said
 * could wait until Monday arrives here, beside what tonight decided, what
 * happened, and what memory changed.
 */
export function mondayOf(state: TwinState): MondayBriefing {
  const e = evaluate(state);
  const ready = state.phase === "closed" || state.phase === "remembered";
  const run = state.outcome?.actual;
  const t = e.twin;
  const agenda = e.decisions
    .filter((d) => d.lane === "can_wait" && d.domain !== "watch")
    .map((d) => ({ title: d.title, why: d.status === "approved" ? `Flagged on ${e.scenario.day}. ${d.whyItMatters}` : d.whyItMatters }));
  for (const inv of t.invoices.filter((i) => i.verdict === "price" && !agenda.some((a) => a.title.includes(i.vendor)))) {
    agenda.push({ title: `${inv.vendor}: ${Math.round(inv.deltaPct)}% over contract`, why: `${signedUsd(inv.priceEffect)} this week from price alone.` });
  }
  const learned = state.phase === "remembered" ? memoriesFor(state).filter((m) => m.updatedTonight).map((m) => (m.status === "needs_revalidation" ? `Now in doubt: ${m.statement}` : `Strengthened: ${m.statement}`)) : [];

  return {
    title: "Monday briefing",
    ready,
    night: run
      ? [
          `${e.scenario.service}: ${run.totals.covers} covers, ${usd(run.totals.sales)} in sales, labor ${run.totals.laborPct.toFixed(1)}%.`,
          `Peak ${one(run.totals.peakLoad)} covers per server; tickets ${run.totals.worstTicket} minutes at worst${run.totals.walkAways ? `; ${run.totals.walkAways} walk-ins left` : ""}.`,
          ...run.totals.soldOut.map((s) => `${s.name} sold out at ${clock(s.at)}.`),
        ]
      : [],
    decided: state.receipts.map((r) => ({ id: r.decisionId, line: `${r.chosen}: ${r.recommended}` })),
    agenda,
    learned,
    cash: `Projected weekly cash ${usd(t.cash.projected)}, against your floor of ${usd(t.cash.floor)}.`,
  };
}

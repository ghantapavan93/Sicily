import type { Minutes } from "@/domain/clock";
import { HOUSE } from "@/domain/venue";
import { clock, one } from "./format";
import { ADDED_SHIFT, EARLY_OUT_AT, SLOTS } from "./twin";
import type { Decision, ItemId, NightPoint, NightRun, Scenario, Twin } from "./types";

/*
 * What happens next. A deterministic, clearly synthetic model of the rest of
 * the night, run from the same twin the decisions came from. It exists so an
 * owner can see a choice's consequence before making it. It is not a
 * forecast of real money and is labelled that way wherever it is shown.
 */

/** Minutes added to tickets for each cover per server over the ceiling. */
const TICKET_PER_OVERLOAD = 2.5;
/** Ticket time at which the floor is visibly behind. */
export const TICKET_ALERT = 16;
/** The peak hour, where walk-ins concentrate. */
const PEAK_SLOTS = new Set([SLOTS[2]!.at, SLOTS[3]!.at]);
/** A sold-out dish loses about this share of the check for each order it can't fill. */
const SOLD_OUT_CHECK_SHARE = 0.25;

export interface Choices {
  addServer: boolean;
  earlyOut: boolean;
  /** Backup stock somebody actually knows about, by item. */
  backup: Partial<Record<ItemId, number>>;
  /** Line counts corrected by a recount, by item. */
  line?: Partial<Record<ItemId, number>>;
  /** Dishes with a planned substitute once they run out: no lost sales, no scramble. */
  substitute?: Partial<Record<ItemId, string>>;
}

const shiftCost = (start: Minutes, end: Minutes) => ((end - start) / 60) * HOUSE.serverRate;

export function simulate(s: Scenario, t: Twin, choices: Choices, branch: NightRun["branch"], label: string): NightRun | null {
  const booked = t.demand.booked?.value;
  if (booked === undefined) return null;

  const working = t.staffing.scheduled.filter((x) => !t.staffing.calledOut.some((c) => c.id === x.id));
  const lastIn = [...working].sort((a, b) => b.start - a.start || a.name.localeCompare(b.name))[0];
  const onCall = t.staffing.onCall;
  const canAdd = choices.addServer && onCall !== null && s.onCallAccepts;

  // Wages with no change, then the chosen changes on top.
  const addedNow = t.staffing.added.length ? shiftCost(ADDED_SHIFT.start, ADDED_SHIFT.end) : 0;
  const cutNow = t.staffing.cut[0] ? shiftCost(t.staffing.cut[0].start, t.staffing.cut[0].end) : 0;
  let wages = t.labor.wages - addedNow + cutNow;
  if (canAdd) wages += shiftCost(ADDED_SHIFT.start, ADDED_SHIFT.end);
  if (choices.earlyOut && lastIn) wages -= shiftCost(EARLY_OUT_AT, lastIn.end);

  const otherWalkIns = Math.max(0, s.plan.walkIns - s.plan.peakWalkIns);
  const offPeakShare = SLOTS.filter((x) => !PEAK_SLOTS.has(x.at)).reduce((n, x) => n + x.share, 0);
  const event = t.demand.nearbyEvent?.value ?? null;
  const avgCheck = (t.labor.projectedSales ?? s.plan.sales) / (booked + s.plan.walkIns);

  const items = (Object.keys(s.items) as ItemId[]).map((id) => {
    const line = t.inventory.find((i) => i.item === id);
    const spec = s.items[id]!;
    const onLine = choices.line?.[id] ?? line?.line?.value ?? 0;
    return { id, name: spec.name, mix: spec.mix, left: onLine + (choices.backup[id] ?? 0), soldAt: null as Minutes | null, sub: choices.substitute?.[id] ?? null };
  });

  const points: NightPoint[] = [];
  let sales = 0;
  let covers = 0;
  let walkAways = 0;
  for (const slot of SLOTS) {
    const bookedHere = booked * slot.share;
    let walkInsHere = PEAK_SLOTS.has(slot.at) ? s.plan.peakWalkIns / 2 : (otherWalkIns * slot.share) / offPeakShare;
    if (event && slot.at >= event.endsAt - 15 && slot.at < event.endsAt + 45) walkInsHere += event.extraWalkIns / 2;

    let servers = working.filter((x) => x.start <= slot.at && slot.at < x.end).length;
    if (canAdd && slot.at >= ADDED_SHIFT.start && slot.at < ADDED_SHIFT.end) servers += 1;
    if (choices.earlyOut && lastIn && slot.at >= EARLY_OUT_AT && slot.at < lastIn.end) servers -= 1;
    servers = Math.max(1, servers);

    const seatedTry = bookedHere + walkInsHere;
    const load = (seatedTry * 2) / servers;
    const over = load - HOUSE.loadCeiling;
    const lost = over > 1 ? Math.round(walkInsHere * Math.min(0.5, over / 8)) : 0;
    const seated = seatedTry - lost;
    const ticketMinutes = Math.round(HOUSE.baseTicketMinutes + Math.max(0, over) * TICKET_PER_OVERLOAD);

    let slotSales = seated * avgCheck;
    for (const it of items) {
      const want = booked * it.mix * slot.share;
      const filled = Math.min(it.left, want);
      if (filled < want && it.soldAt === null) {
        const fraction = want === 0 ? 0 : filled / want;
        it.soldAt = Math.round((slot.at + 30 * fraction) / 5) * 5;
      }
      it.left = Math.max(0, it.left - want);
      if (!it.sub) slotSales -= (want - filled) * avgCheck * SOLD_OUT_CHECK_SHARE;
    }

    sales += slotSales;
    covers += seated;
    walkAways += lost;

    const alerts: string[] = [];
    if (load > HOUSE.loadCeiling) alerts.push("Floor over ceiling");
    if (ticketMinutes >= TICKET_ALERT) alerts.push(`Tickets ${ticketMinutes} min`);
    if (lost > 0) alerts.push(`${lost} walk-ins left`);
    for (const it of items) if (!it.sub && it.soldAt !== null && it.soldAt <= slot.at + 30) alerts.push(`${it.name} 86'd`);

    points.push({
      at: slot.at,
      covers: Math.round(seated),
      servers,
      load: Number(load.toFixed(1)),
      ticketMinutes,
      itemsLeft: Object.fromEntries(items.map((it) => [it.id, Math.round(it.left)])),
      sales: Math.round(sales),
      lost,
      alerts,
    });
  }

  const actions: string[] = [];
  if (canAdd && onCall) actions.push(`Added ${onCall.name}, ${clock(ADDED_SHIFT.start)} to ${clock(ADDED_SHIFT.end)}`);
  if (choices.addServer && !canAdd) actions.push("Asked for an added server; nobody could come");
  if (choices.earlyOut && lastIn) actions.push(`${lastIn.name} left at ${clock(EARLY_OUT_AT)}`);
  for (const [id, n] of Object.entries(choices.backup)) if (n) actions.push(`Walk-in checked: ${n} ${s.items[id as ItemId]?.name.toLowerCase() ?? id}`);
  for (const [id, n] of Object.entries(choices.line ?? {})) actions.push(`Recounted: ${n} ${s.items[id as ItemId]?.name.toLowerCase() ?? id} on the line`);
  for (const [id, sub] of Object.entries(choices.substitute ?? {})) if (sub) actions.push(`${s.items[id as ItemId]?.name ?? id} capped, then ${sub}`);
  if (actions.length === 0) actions.push("Nothing changed");

  return {
    branch,
    label,
    points,
    totals: {
      covers: Math.round(covers),
      sales: Math.round(sales),
      wages: Math.round(wages),
      laborPct: (wages / sales) * 100,
      peakLoad: Math.max(...points.map((p) => p.load)),
      worstTicket: Math.max(...points.map((p) => p.ticketMinutes)),
      walkAways,
      soldOut: items.filter((it) => it.soldAt !== null && !it.sub).map((it) => ({ item: it.id, name: it.name, at: it.soldAt! })),
      peakAlerts: Math.max(...points.map((p) => p.alerts.length)),
    },
    actions,
  };
}

/** What Savy's plan would do: its recommendations as drafted, and the counts it asked for. */
export function planChoices(s: Scenario, t: Twin, decisions: Decision[]): Choices {
  const staffing = decisions.find((d) => d.key === "staffing");
  const rec = staffing && (staffing.status === "recommend" || staffing.status === "approved") ? staffing.recommendation : null;
  const backup: Choices["backup"] = {};
  const line: NonNullable<Choices["line"]> = {};
  const substitute: NonNullable<Choices["substitute"]> = {};
  for (const i of t.inventory) {
    if (i.backup) backup[i.item] = i.backup.value;
    else if (i.status === "needs_backup_count") backup[i.item] = s.items[i.item]?.truth.backup ?? 0;
    // Savy's plan asks for the count it is missing; the simulation uses what the manager would find.
    if (i.status === "needs_count" || i.status === "discrepancy") line[i.item] = s.items[i.item]?.truth.line ?? 0;
  }
  for (const d of decisions) {
    if (d.key.startsWith("supply:") && (d.status === "recommend" || d.status === "approved")) substitute[d.key.slice(7) as ItemId] = "arugula";
  }
  return {
    addServer: Boolean(rec?.approvable && rec.action.startsWith("Offer") && !rec.action.includes("early out")),
    earlyOut: Boolean(rec?.action.includes("early out")),
    backup,
    line,
    substitute,
  };
}

/** Nobody acts: no shift changes and nobody checks the walk-in. Counts already on record still count. */
export function nothingChoices(t: Twin): Choices {
  const backup: Choices["backup"] = {};
  for (const i of t.inventory) if (i.backup && i.backup.basis !== "reported") backup[i.item] = i.backup.value;
  return { addServer: false, earlyOut: false, backup };
}

/** What people have actually done tonight. */
export function chosenChoices(t: Twin, decisions: Decision[]): Choices {
  const backup: Choices["backup"] = {};
  const substitute: NonNullable<Choices["substitute"]> = {};
  for (const i of t.inventory) if (i.backup) backup[i.item] = i.backup.value;
  for (const d of decisions) if (d.key.startsWith("supply:") && d.status === "approved") substitute[d.key.slice(7) as ItemId] = "arugula";
  return { addServer: t.staffing.added.length > 0, earlyOut: t.staffing.cut.length > 0, backup, substitute };
}

export interface Fork {
  nothing: NightRun;
  plan: NightRun;
  /** The choices each branch was run with, so a view can rebuild any moment of it. */
  choices: { nothing: Choices; plan: Choices };
}

export function forkOf(s: Scenario, t: Twin, decisions: Decision[]): Fork | null {
  const choices = { nothing: nothingChoices(t), plan: planChoices(s, t, decisions) };
  const nothing = simulate(s, t, choices.nothing, "nothing", "No change");
  const savy = simulate(s, t, choices.plan, "plan", "Savy's plan");
  return nothing && savy ? { nothing, plan: savy, choices } : null;
}

/** One-line reading of a run, for receipts, memory and Savy's answers. */
export function summaryOf(run: NightRun): string {
  const sold = run.totals.soldOut.map((x) => `${x.name} sold out at ${clock(x.at)}`).join("; ");
  return `Peak ${one(run.totals.peakLoad)} covers per server, tickets ${run.totals.worstTicket} min at worst${run.totals.walkAways ? `, ${run.totals.walkAways} walk-ins left` : ""}${sold ? `. ${sold}` : ""}.`;
}

import { at, type Minutes } from "@/domain/clock";
import { HOUSE } from "@/domain/venue";
import { COVER_TOLERANCE, dedupe, healthOf, latest, readingOf } from "./ledger";
import type {
  EventOf,
  InventoryLine,
  InvoiceView,
  ItemId,
  PoLine,
  PoStatus,
  Reading,
  ReconcileReport,
  Scenario,
  Shift,
  Twin,
  TwinEvent,
} from "./types";

/*
 * UNDERSTAND. The twin is what the restaurant looks like tonight, built only
 * from events Savy has processed. Every figure on every screen comes from
 * here, and every figure carries the event it came from.
 */

export type TwinCore = Omit<Twin, "cash">;

export interface TwinInput {
  scenario: Scenario;
  clock: Minutes;
  /** Arrived and processed events, plus events people caused from the screen. */
  events: readonly TwinEvent[];
  resolution: "book" | "host" | null;
  staffing: { added: boolean; cut: boolean };
  po: { status: PoStatus; orders: string[] };
}

/* ------------------------------------------------------------------ */
/* The shape of a night                                                */
/* ------------------------------------------------------------------ */

/** Half-hour seating slots for dinner, and the share of booked covers in each, from sample history. */
export const SLOTS: { at: Minutes; share: number }[] = [
  { at: at(18, 0), share: 0.08 },
  { at: at(18, 30), share: 0.12 },
  { at: at(19, 0), share: 0.18 },
  { at: at(19, 30), share: 0.17 },
  { at: at(20, 0), share: 0.14 },
  { at: at(20, 30), share: 0.11 },
  { at: at(21, 0), share: 0.08 },
  { at: at(21, 30), share: 0.07 },
  { at: at(22, 0), share: 0.05 },
];

/** The on-call shift and the early-out, as the twin plans them. */
export const ADDED_SHIFT = { start: at(18, 30), end: at(21, 30) };
export const EARLY_OUT_AT = at(20, 0);
/** Tomorrow's order carries this much over the forecast. */
export const ORDER_BUFFER = 1.1;
/** A count this far from what receiving expects is a discrepancy, not usage. */
export const COUNT_TOLERANCE = 0.25;
/** More than this multiple of the forecast on hand is a surplus. */
export const SURPLUS_MULTIPLE = 1.6;

/** The afternoon count is due a little before Savy is expected to have a plan. */
export const countsDueBy = (s: Scenario) => s.decideAt - 2;

export const peakCoversFor = (booked: number, walkIns: number = HOUSE.peakWalkIns) => Math.round(booked * HOUSE.peakHourShare) + walkIns;
export const loadPerServer = (peakCovers: number, servers: number) => peakCovers / servers;
const hours = (from: Minutes, to: Minutes) => Math.max(0, to - from) / 60;

/** When cumulative demand passes what is on hand, to the nearest five minutes. Null if it never does. */
export function runOutAt(forecast: number, available: number): Minutes | null {
  let used = 0;
  for (const slot of SLOTS) {
    const need = forecast * slot.share;
    if (used + need > available) {
      const fraction = need === 0 ? 0 : (available - used) / need;
      return Math.round((slot.at + 30 * fraction) / 5) * 5;
    }
    used += need;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Understand                                                          */
/* ------------------------------------------------------------------ */

export function understand(input: TwinInput): TwinCore {
  const { scenario, clock } = input;
  const { kept: events, duplicates } = dedupe(input.events);
  const plan = scenario.plan;

  const report: ReconcileReport = { verified: [], stale: [], duplicates, conflicts: [], missing: [], unverified: [] };
  const verify = (claim: string, e: TwinEvent) => report.verified.push({ claim, eventId: e.id });

  /* Demand ---------------------------------------------------------- */
  const bookEvent = latest(events, "reservations.updated", (e) => e.payload.system === "book");
  const hostEvent = latest(events, "reservations.updated", (e) => e.payload.system === "host");
  const book = bookEvent ? readingOf(bookEvent, bookEvent.payload.covers, clock, "expected") : null;
  const host = hostEvent ? readingOf(hostEvent, hostEvent.payload.covers, clock, "expected") : null;

  let booked: Reading<number> | null = book;
  let disputed: Reading<number> | null = null;
  if (book && host && Math.abs(book.value - host.value) / Math.max(book.value, host.value) > COVER_TOLERANCE) {
    report.conflicts.push({ claim: "Covers booked tonight", a: book, b: host, resolvedBy: input.resolution });
    if (input.resolution === "host") booked = host;
    else if (input.resolution !== "book") disputed = host;
  }
  if (booked && !disputed && bookEvent) verify(`${booked.value} covers booked`, input.resolution === "host" && hostEvent ? hostEvent : bookEvent);

  const coversKnown = booked !== null && disputed === null;
  const peakCovers = coversKnown ? peakCoversFor(booked!.value, plan.peakWalkIns) : null;
  const totalCovers = coversKnown ? booked!.value + plan.walkIns : null;

  const eventListing = latest(events, "event.listed");
  const nearbyEvent = eventListing ? readingOf(eventListing, eventListing.payload, clock, "expected") : null;
  if (eventListing) report.unverified.push({ claim: `${eventListing.payload.name}, ends at the listed time`, eventId: eventListing.id });

  /* Staffing -------------------------------------------------------- */
  const schedule = latest(events, "schedule.published");
  const scheduled: Shift[] = schedule?.payload.shifts ?? [];
  const calloutEvents = events.filter((e): e is EventOf<"staff.callout"> => e.kind === "staff.callout");
  const calloutIds = new Set(calloutEvents.map((e) => e.payload.shiftId));
  const calledOut = scheduled.filter((s) => calloutIds.has(s.id));
  if (schedule) verify(`${scheduled.length} servers scheduled`, schedule);
  for (const e of events) if (e.kind === "staff.callout") verify(`${calledOut.find((s) => s.id === e.payload.shiftId)?.name ?? "A server"} called out`, e);

  const onCall = schedule?.payload.onCall ?? null;
  const added: Shift[] =
    input.staffing.added && onCall ? [{ id: onCall.id, name: onCall.name, role: "server", start: ADDED_SHIFT.start, end: ADDED_SHIFT.end }] : [];
  const working = scheduled.filter((s) => !calloutIds.has(s.id));
  // The early out goes to whoever started last, after the peak hour.
  const lastIn = [...working].sort((a, b) => b.start - a.start || a.name.localeCompare(b.name))[0];
  const cut: Shift[] = input.staffing.cut && lastIn ? [{ ...lastIn, start: EARLY_OUT_AT }] : [];

  const servers = working.length;
  const peakLoad = peakCovers !== null && servers > 0 ? loadPerServer(peakCovers, servers + added.length) : null;
  const loadWithOneMore = peakCovers !== null ? loadPerServer(peakCovers, servers + 1) : null;
  const loadWithOneLess = peakCovers !== null && servers > 1 ? loadPerServer(peakCovers, servers - 1) : null;

  /* Sales and labor ------------------------------------------------- */
  const salesEvent = latest(events, "sales.updated");
  const sales = salesEvent ? readingOf(salesEvent, { soFar: salesEvent.payload.soFar, planSoFar: salesEvent.payload.planSoFar }, clock, "actual") : null;
  if (sales?.freshness === "fresh" && salesEvent) verify("Sales since open", salesEvent);
  if (sales?.freshness === "stale") report.stale.push({ source: "pos", claim: "Sales since open", ageMin: clock - sales.at });

  const rate = HOUSE.serverRate;
  // A call-out removes the whole shift from tonight's wages.
  const calloutSavings = calledOut.reduce((sum, s) => sum + hours(s.start, s.end) * rate, 0);
  const addedCost = added.reduce((sum, s) => sum + hours(s.start, s.end) * rate, 0);
  const cutSavings = cut.reduce((sum, s) => sum + hours(EARLY_OUT_AT, s.end) * rate, 0);
  const wages = plan.wages - calloutSavings + addedCost - cutSavings;
  const projectedSales = sales && sales.freshness === "fresh" && sales.value.planSoFar > 0 ? (plan.sales * sales.value.soFar) / sales.value.planSoFar : null;
  const laborPct = projectedSales ? (wages / projectedSales) * 100 : null;

  /* Inventory ------------------------------------------------------- */
  const inventory: InventoryLine[] = [];
  for (const [id, spec] of Object.entries(scenario.items) as [ItemId, NonNullable<Scenario["items"][ItemId]>][]) {
    const lineEvent = latest(events, "inventory.count", (e) => e.payload.item === id && e.payload.place === "line");
    const backupEvent = latest(events, "inventory.count", (e) => e.payload.item === id && e.payload.place === "backup");
    const expectedEvent = latest(events, "inventory.expected", (e) => e.payload.item === id);
    const line = lineEvent ? readingOf(lineEvent, lineEvent.payload.onHand, clock, lineEvent.payload.reportedBy === "manager" ? "reported" : "actual") : null;
    const backup = backupEvent ? readingOf(backupEvent, backupEvent.payload.onHand, clock, backupEvent.payload.reportedBy === "manager" ? "reported" : "actual") : null;
    const expected = expectedEvent?.payload.onHand ?? null;
    if (lineEvent) verify(`${spec.name}: ${lineEvent.payload.onHand} on the line`, lineEvent);
    if (backupEvent) verify(`${spec.name}: ${backupEvent.payload.onHand} in backup`, backupEvent);

    const forecast = coversKnown ? Math.round(booked!.value * spec.mix) : null;
    const recounted = lineEvent?.payload.reportedBy === "manager";
    let status: InventoryLine["status"];
    let exposure: number | null = null;
    let runOut: Minutes | null = null;

    if (!line && clock < countsDueBy(scenario)) {
      status = "not_due";
    } else if (!line) {
      status = "needs_count";
      report.missing.push({ claim: `${spec.name} count`, why: "This afternoon's count was never entered." });
    } else if (!recounted && expected !== null && expected > 0 && Math.abs(line.value - expected) / expected > COUNT_TOLERANCE) {
      status = "discrepancy";
      report.missing.push({ claim: `${spec.name} count`, why: `The count (${line.value}) is far from what receiving expects (${expected}).` });
    } else if (forecast === null) {
      status = "blocked";
    } else {
      const onHand = line.value + (backup?.value ?? 0);
      exposure = forecast - onHand;
      runOut = runOutAt(forecast, onHand);
      if (exposure > 0 && backup === null) {
        status = "needs_backup_count";
        report.missing.push({ claim: `Backup ${spec.name.toLowerCase()}`, why: "The walk-in has not been counted today." });
      } else if (exposure > 0) status = "short";
      else if (line.value > forecast * SURPLUS_MULTIPLE) status = "surplus";
      else status = "ok";
    }
    inventory.push({ item: id, name: spec.name, line, backup, expected, forecast, exposure, runOutAt: runOut, status });
  }

  /* Deliveries and invoices ----------------------------------------- */
  const deliveries = events
    .filter((e): e is EventOf<"delivery.received"> => e.kind === "delivery.received")
    .map((e) => ({
      vendor: e.payload.vendor,
      item: e.payload.item,
      name: scenario.items[e.payload.item]?.name ?? e.payload.item,
      ordered: e.payload.ordered,
      received: e.payload.received,
      short: e.payload.ordered - e.payload.received,
      unitCost: e.payload.unitCost,
      portionsPerUnit: e.payload.portionsPerUnit,
      eventId: e.id,
    }));
  for (const d of deliveries) verify(`${d.vendor}: ${d.received} of ${d.ordered} delivered`, events.find((e) => e.id === d.eventId)!);

  const invoices: InvoiceView[] = events
    .filter((e): e is EventOf<"invoice.received"> => e.kind === "invoice.received")
    .map((e) => {
      const inv = e.payload;
      const total = inv.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      const contractTotal = inv.lines.reduce((s, l) => s + l.usualQty * l.contractPrice, 0);
      const priceEffect = inv.lines.reduce((s, l) => s + l.qty * (l.unitPrice - l.contractPrice), 0);
      const volumeEffect = inv.lines.reduce((s, l) => s + (l.qty - l.usualQty) * l.contractPrice, 0);
      const deltaPct = contractTotal > 0 ? ((total - contractTotal) / contractTotal) * 100 : 0;
      const moved = Math.abs(priceEffect) + Math.abs(volumeEffect);
      const verdict: InvoiceView["verdict"] =
        Math.abs(deltaPct) < 2 ? "in_line" : Math.abs(priceEffect) >= 0.7 * moved ? "price" : Math.abs(volumeEffect) >= 0.7 * moved ? "volume" : "both";
      verify(`${inv.vendor} ${inv.number}`, e);
      return {
        key: `invoice:${inv.number}`,
        vendor: inv.vendor,
        number: inv.number,
        total,
        contractTotal,
        previousAvg: inv.previousTotals.reduce((s, n) => s + n, 0) / Math.max(1, inv.previousTotals.length),
        priceEffect,
        volumeEffect,
        deltaPct,
        verdict,
        lines: inv.lines.map((l) => ({ item: l.item, qty: l.qty, usualQty: l.usualQty, unitPrice: l.unitPrice, contractPrice: l.contractPrice })),
        eventId: e.id,
        duplicatesSuppressed: duplicates.filter((d) => d.kept === e.id).length,
      };
    });

  /* Tomorrow's order ------------------------------------------------ */
  const lines: PoLine[] = [];
  for (const item of inventory) {
    const spec = scenario.items[item.item];
    if (!spec || item.forecast === null || !item.line || item.status === "needs_count" || item.status === "discrepancy") continue;
    const need = plan.tomorrowCovers * spec.mix * ORDER_BUFFER;
    const left = Math.max(0, item.line.value + (item.backup?.value ?? 0) - item.forecast);
    const qty = Math.round(need - left - spec.standing);
    if (qty === 0) continue;
    const why =
      qty > 0
        ? `${Math.round(need)} needed for ${plan.tomorrowCovers} covers tomorrow, ${left} left tonight${item.backup ? "" : " (backup not counted)"}, ${spec.standing} already on the standing order.`
        : `Only ${Math.round(need)} needed tomorrow and ${left} will be left tonight. The standing order of ${spec.standing} is more than enough.`;
    lines.push({ item: item.item, name: spec.name, qty, unitCost: spec.unitCost, why });
  }
  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0);

  return {
    scenario: scenario.id,
    clock,
    demand: {
      planCovers: plan.covers,
      booked,
      disputed,
      peakCovers,
      totalCovers,
      vsPlanPct: coversKnown ? ((booked!.value - plan.covers) / plan.covers) * 100 : null,
      nearbyEvent,
    },
    staffing: {
      scheduled,
      calledOut,
      calloutRefs: calloutEvents.map((e) => ({ shiftId: e.payload.shiftId, eventId: e.id, at: e.availableAt })),
      added,
      cut,
      servers,
      onCall,
      peakLoad,
      loadWithOneMore,
      loadWithOneLess,
      ceiling: HOUSE.loadCeiling,
      floor: HOUSE.loadFloor,
    },
    sales,
    labor: { wages, projectedSales, pct: laborPct, goalPct: HOUSE.laborGoalPct },
    inventory,
    deliveries,
    purchasing: { lines, total, status: lines.length === 0 ? "none" : input.po.status, orders: input.po.orders },
    invoices,
    health: healthOf(input.events, clock),
    ledger: report,
  };
}

import { at, type Minutes } from "@/domain/clock";
import type { OperatorAction, ServiceDay, Situation, SituationParams } from "./types";

/**
 * Thirty synthetic dinner services and the 47 situations Savy would have
 * noticed in them. Nothing here is measured. It exists to show the mechanism:
 * replay the past, compare with what people actually did, count honestly.
 *
 * The summary numbers on screen are computed from these rows, never typed in.
 */

/* ------------------------------------------------------------------ */
/* The thirty services before tonight (closed Mondays)                 */
/* ------------------------------------------------------------------ */

const TONIGHT_UTC = Date.UTC(2026, 9, 2); // Friday, Oct 2, 2026
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function buildServices(count: number): ServiceDay[] {
  const days: ServiceDay[] = [];
  for (let back = 1; days.length < count; back++) {
    const date = new Date(TONIGHT_UTC - back * DAY_MS);
    const weekday = WEEKDAYS[date.getUTCDay()] ?? "";
    if (weekday === "Mon") continue;
    days.push({ index: 0, weekday, label: `${weekday} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}` });
  }
  return days.reverse().map((d, i) => ({ ...d, index: i + 1 }));
}

export const SERVICES: ServiceDay[] = buildServices(30);

/* ------------------------------------------------------------------ */
/* Row helper                                                          */
/* ------------------------------------------------------------------ */

function row(
  id: string,
  service: number,
  detectedAt: Minutes,
  impactUsd: number,
  params: SituationParams,
  operator: [action: OperatorAction, at: Minutes | null, reason?: string],
  result: [materialized: boolean, note: string],
  tags: string[] = [],
): Situation {
  const [action, actedAt, reason] = operator;
  const [materialized, note] = result;
  return {
    id,
    service,
    detectedAt,
    impactUsd,
    params,
    operator: reason === undefined ? { action, at: actedAt } : { action, at: actedAt, reason },
    result: { materialized, note },
    tags,
  };
}

const PRODUCE = "Greenline Produce";

/* ------------------------------------------------------------------ */
/* The 47 situations                                                   */
/* ------------------------------------------------------------------ */

export const SITUATIONS: Situation[] = [
  /* Coverage gaps ---------------------------------------------------- */
  row("COV-01", 1, at(17, 36), 240,
    { kind: "coverage_gap", covers: 158, usual: 126, scheduled: 5, servers: 4, callout: true },
    ["added_server", at(17, 52)],
    [true, "Peak ran at 13.8 covers per server. Ticket times held."],
    ["surge_callout", "foh_choice"]),
  row("COV-02", 13, at(17, 44), 290,
    { kind: "coverage_gap", covers: 171, usual: 126, scheduled: 5, servers: 4, callout: true },
    ["added_server", at(18, 2)],
    [true, "Peak ran at 14.8 covers per server. Ticket times held."],
    ["surge_callout", "foh_choice"]),
  row("COV-03", 20, at(17, 28), 260,
    { kind: "coverage_gap", covers: 168, usual: 140, scheduled: 5, servers: 4, callout: true },
    ["added_server", at(17, 41)],
    [true, "Peak ran at 14.6 covers per server. Ticket times held."],
    ["surge_callout", "foh_choice"]),
  row("COV-04", 8, at(18, 10), 180,
    { kind: "coverage_gap", covers: 162, usual: 140, scheduled: 4, servers: 4, callout: false },
    ["added_server", at(18, 31)],
    [true, "Peak ran at 14.2 covers per server after the added server arrived."],
    ["foh_choice"]),
  row("COV-05", 26, at(17, 50), 210,
    { kind: "coverage_gap", covers: 166, usual: 140, scheduled: 4, servers: 4, callout: false },
    ["added_server", at(18, 5)],
    [true, "Peak ran at 14.4 covers per server. Ticket times held."],
    ["foh_choice"]),
  row("COV-06", 14, at(18, 5), 170,
    { kind: "coverage_gap", covers: 160, usual: 140, scheduled: 4, servers: 4, callout: false },
    ["expanded_sections", at(18, 20), "Nobody was available to come in."],
    [true, "Sections went from 5 tables to 7. Ticket times reached 19 minutes."],
    ["foh_choice"]),
  row("COV-07", 19, at(17, 40), 220,
    { kind: "coverage_gap", covers: 159, usual: 126, scheduled: 5, servers: 4, callout: true },
    ["added_server", at(17, 22)],
    [true, "The manager took the call-out by phone and had a server in before Savy's read."],
    ["surge_callout", "foh_choice"]),
  row("COV-08", 9, at(16, 55), 55,
    { kind: "coverage_gap", covers: 118, usual: 96, scheduled: 3, servers: 3, callout: false },
    ["added_server", at(16, 30)],
    [true, "The manager had already added a server after seeing the book at 4:30 PM."]),
  row("COV-09", 23, at(17, 15), 52,
    { kind: "coverage_gap", covers: 132, usual: 88, scheduled: 3, servers: 3, callout: false },
    ["none", null],
    [false, "A party of 40 cancelled at 5:50 PM. The night closed at 91 covers."]),

  /* Prep shortfalls -------------------------------------------------- */
  row("PREP-01", 7, at(16, 40), 150,
    { kind: "prep_shortfall", item: "Branzino", onHand: 20, expected: 29 },
    ["prepped_more", at(16, 58)],
    [true, "The chef broke down a second case. 28 sold."]),
  row("PREP-02", 20, at(16, 35), 104,
    { kind: "prep_shortfall", item: "Burrata", onHand: 24, expected: 37 },
    ["prepped_more", at(16, 50)],
    [true, "A runner picked up two more cases. 35 sold."]),
  row("PREP-03", 12, at(16, 50), 28,
    { kind: "prep_shortfall", item: "Focaccia", onHand: 30, expected: 41 },
    ["prepped_more", at(17, 5)],
    [true, "A second bake went in. 40 sold."]),
  row("PREP-04", 2, at(16, 42), 40,
    { kind: "prep_shortfall", item: "Tiramisu", onHand: 22, expected: 30 },
    ["none", null],
    [true, "Ran out at 9:05 PM."]),
  row("PREP-05", 16, at(16, 30), 30,
    { kind: "prep_shortfall", item: "Focaccia", onHand: 28, expected: 40 },
    ["none", null],
    [true, "Ran out at 8:20 PM."]),
  row("PREP-06", 25, at(16, 48), 45,
    { kind: "prep_shortfall", item: "Arancini", onHand: 36, expected: 46 },
    ["none", null],
    [true, "Ran out at 8:40 PM."]),
  row("PREP-07", 5, at(16, 45), 30,
    { kind: "prep_shortfall", item: "Focaccia", onHand: 26, expected: 38 },
    ["prepped_more", at(15, 50)],
    [true, "The second bake was already in the oven when the count was entered."]),
  row("PREP-08", 27, at(16, 20), 42,
    { kind: "prep_shortfall", item: "Tiramisu", onHand: 18, expected: 27 },
    ["prepped_more", at(15, 30)],
    [true, "Pastry had already started a second tray."]),

  /* Overtime drift --------------------------------------------------- */
  row("OT-01", 9, at(19, 10), 94,
    { kind: "overtime_drift", role: "line cook", weekHours: 37.5, projected: 43 },
    ["cut_early", at(19, 40)],
    [true, "Shift ended at 9 PM. The week closed at 39.5 hours."]),
  row("OT-02", 15, at(18, 50), 68,
    { kind: "overtime_drift", role: "dishwasher", weekHours: 38, projected: 42.5 },
    ["cut_early", at(19, 15)],
    [true, "Shift ended at 8:45 PM. The week closed at 40 hours."]),
  row("OT-03", 21, at(19, 20), 110,
    { kind: "overtime_drift", role: "line cook", weekHours: 38.5, projected: 44 },
    ["cut_early", at(20, 0)],
    [true, "Shift ended at 9:15 PM. The week closed at 40.5 hours."]),
  row("OT-04", 3, at(19, 5), 36,
    { kind: "overtime_drift", role: "server", weekHours: 38, projected: 41 },
    ["cut_early", at(19, 30)],
    [true, "Cut after the second turn. The week closed at 39.5 hours."]),
  row("OT-05", 14, at(20, 10), 48,
    { kind: "overtime_drift", role: "bartender", weekHours: 39, projected: 42 },
    ["none", null],
    [true, "3.1 overtime hours were paid."]),
  row("OT-06", 26, at(20, 25), 30,
    { kind: "overtime_drift", role: "server", weekHours: 38.5, projected: 41.5 },
    ["none", null],
    [true, "1.6 overtime hours were paid."]),
  row("OT-07", 27, at(19, 0), 58,
    { kind: "overtime_drift", role: "line cook", weekHours: 38, projected: 43 },
    ["cut_early", at(18, 30)],
    [true, "The chef had already re-cut the line at 6:30 PM."]),

  /* Invoice variance ------------------------------------------------- */
  row("INV-01", 4, at(15, 10), 86,
    { kind: "invoice_variance", supplier: PRODUCE, item: "Romaine and herbs", variancePct: 12 },
    ["reviewed_invoice", at(15, 40)],
    [true, "A $41 credit was requested."],
    ["produce_variance"]),
  row("INV-02", 10, at(15, 5), 120,
    { kind: "invoice_variance", supplier: PRODUCE, item: "Tomatoes", variancePct: 14 },
    ["reviewed_invoice", at(15, 30)],
    [true, "A case count error was found. $64 credit requested."],
    ["produce_variance"]),
  row("INV-03", 22, at(15, 20), 64,
    { kind: "invoice_variance", supplier: PRODUCE, item: "Lemons and basil", variancePct: 9 },
    ["reviewed_invoice", at(16, 0)],
    [true, "The price change was real. The order guide was updated."],
    ["produce_variance"]),
  row("INV-04", 17, at(15, 15), 38,
    { kind: "invoice_variance", supplier: PRODUCE, item: "Mushrooms", variancePct: 11 },
    ["reviewed_invoice", at(15, 50)],
    [true, "A substitution was billed at the higher grade. Credit requested."],
    ["produce_variance"]),
  row("INV-05", 28, at(15, 0), 12,
    { kind: "invoice_variance", supplier: PRODUCE, item: "Arugula", variancePct: 4 },
    ["none", null],
    [false, "The price was back to normal on the next invoice."],
    ["produce_variance"]),
  row("INV-06", 11, at(15, 25), 38,
    { kind: "invoice_variance", supplier: PRODUCE, item: "Peppers", variancePct: 7 },
    ["none", null],
    [true, "A $38 pack-size error went uncaught."],
    ["produce_variance"]),

  /* Beverage ordering before private events -------------------------- */
  row("BEV-01", 6, at(15, 30), 285,
    { kind: "beverage_overorder", overParPct: 24, orderUsd: 1480, event: "a 100-person private event" },
    ["kept_order", at(15, 45), "Saturday has a 100-person private event."],
    [false, "Sold through by Sunday close. No abnormal waste."],
    ["private_event"]),
  row("BEV-02", 18, at(15, 35), 240,
    { kind: "beverage_overorder", overParPct: 21, orderUsd: 1390, event: "a rehearsal dinner for 80" },
    ["kept_order", at(15, 50), "Rehearsal dinner for 80 on Saturday."],
    [false, "Sold through by Sunday close. No abnormal waste."],
    ["private_event"]),
  row("BEV-03", 24, at(15, 20), 47,
    { kind: "beverage_overorder", overParPct: 18, orderUsd: 310, event: "a wine-pairing party of 40" },
    ["kept_order", at(15, 40), "Wine pairing for a party of 40 on Saturday."],
    [false, "Sold through by Sunday close. No abnormal waste."],
    ["private_event"]),

  /* Stale sources ---------------------------------------------------- */
  row("SRC-01", 7, at(19, 15), 0,
    { kind: "stale_source", source: "POS", ageMin: 38 },
    ["restarted_sync", at(19, 30)],
    [true, "26 minutes of sales arrived late."],
    ["friday_pos_stall"]),
  row("SRC-02", 13, at(18, 40), 0,
    { kind: "stale_source", source: "Timeclock", ageMin: 41 },
    ["restarted_sync", at(19, 5)],
    [true, "Five punches arrived together at 7:06 PM."]),
  row("SRC-03", 25, at(19, 50), 0,
    { kind: "stale_source", source: "POS", ageMin: 33 },
    ["restarted_sync", at(20, 5)],
    [true, "22 minutes of sales arrived late."],
    ["friday_pos_stall"]),
  row("SRC-04", 2, at(20, 5), 0,
    { kind: "stale_source", source: "Reservations", ageMin: 52 },
    ["none", null],
    [true, "Two walk-in parties were seated against a stale book."]),
  row("SRC-05", 29, at(18, 20), 0,
    { kind: "stale_source", source: "Timeclock", ageMin: 47 },
    ["none", null],
    [true, "Three punches arrived the next morning."]),

  /* Late clock-ins --------------------------------------------------- */
  row("PUNCH-01", 1, at(17, 12), 8,
    { kind: "late_clockin", role: "server", lateMin: 12 },
    ["fixed_punch", at(17, 40)],
    [true, "On the floor since 5:02 PM. The punch was added."]),
  row("PUNCH-02", 10, at(16, 14), 9,
    { kind: "late_clockin", role: "line cook", lateMin: 14 },
    ["fixed_punch", at(16, 50)],
    [true, "Arrived at 4:11 PM. The punch was corrected."]),
  row("PUNCH-03", 22, at(17, 11), 6,
    { kind: "late_clockin", role: "host", lateMin: 11 },
    ["fixed_punch", at(17, 30)],
    [true, "On the floor on time. The punch was added."]),
  row("PUNCH-04", 16, at(16, 42), 7,
    { kind: "late_clockin", role: "dishwasher", lateMin: 12 },
    ["fixed_punch", at(16, 35)],
    [true, "The manager had already added the punch by hand."]),
  row("PUNCH-05", 30, at(17, 13), 8,
    { kind: "late_clockin", role: "server", lateMin: 13 },
    ["none", null],
    [true, "The missing punch became a payroll exception."]),

  /* Comps and voids -------------------------------------------------- */
  row("VOID-01", 8, at(20, 40), 45,
    { kind: "comp_void_spike", count: 9, usual: 3 },
    ["reviewed_checks", at(21, 10)],
    [true, "A printer fault had doubled four tickets."]),
  row("VOID-02", 19, at(20, 55), 38,
    { kind: "comp_void_spike", count: 8, usual: 3 },
    ["reviewed_checks", at(21, 30)],
    [true, "A large party's check was split and re-rung."]),
  row("VOID-03", 30, at(20, 20), 30,
    { kind: "comp_void_spike", count: 7, usual: 3 },
    ["reviewed_checks", at(21, 0)],
    [true, "Three comps for a long ticket time were confirmed."]),
  row("VOID-04", 15, at(20, 30), 41,
    { kind: "comp_void_spike", count: 8, usual: 3 },
    ["none", null],
    [true, "Six voids on one terminal were never explained."]),
];

export const REPLAY_WINDOW = { opens: at(14, 0), closes: at(23, 0) } as const;

/** The service the demo opens on: a surge Friday with a call-out, like tonight. */
export const FEATURED_SERVICE = 13;

import { at, type Minutes } from "@/domain/clock";
import type { EventKind, EventOf, Invoice, Scenario, ScenarioId, Shift, SourceId, TwinEvent } from "./types";

/*
 * Three synthetic nights at the same restaurant. Each is only a plan and a
 * list of events. Nothing below says what Savy should conclude: the engine
 * works that out the same way for every night.
 */

interface AddOptions {
  occurredAt?: Minutes;
  dedupeKey?: string;
  routine?: boolean;
}

function timeline(prefix: string) {
  const events: TwinEvent[] = [];
  const add = <K extends EventKind>(
    kind: K,
    source: SourceId,
    availableAt: Minutes,
    payload: EventOf<K>["payload"],
    summary: string,
    options: AddOptions = {},
  ) => {
    const id = `evt_${prefix}_${String(events.length + 1).padStart(3, "0")}`;
    const event = {
      id,
      kind,
      source,
      occurredAt: options.occurredAt ?? availableAt,
      availableAt,
      dedupeKey: options.dedupeKey ?? id,
      routine: options.routine ?? false,
      summary,
      payload,
    } as unknown as TwinEvent;
    events.push(event);
    return event;
  };
  const heartbeat = (source: SourceId, when: Minutes, note: string) =>
    add("sync.heartbeat", source, when, { note }, note, { routine: true });
  return { events, add, heartbeat };
}

const shift = (id: string, name: string, start: Minutes, end: Minutes): Shift => ({ id, name, role: "server", start, end });

/* ------------------------------------------------------------------ */
/* Friday rush: demand spikes and a server calls out                   */
/* ------------------------------------------------------------------ */

const VALLEY_FRIDAY: Invoice = {
  vendor: "Greenline Produce",
  number: "VP-20931",
  period: "Week 40",
  lines: [
    { item: "Tomatoes, case", qty: 6, usualQty: 6, unitPrice: 46, contractPrice: 38 },
    { item: "Mixed greens, case", qty: 8, usualQty: 8, unitPrice: 58, contractPrice: 52 },
    { item: "Lemons, case", qty: 4, usualQty: 4, unitPrice: 30, contractPrice: 30 },
    { item: "Onions, sack", qty: 7, usualQty: 7, unitPrice: 21, contractPrice: 21 },
    { item: "Herbs, flat", qty: 4, usualQty: 4, unitPrice: 44, contractPrice: 36 },
  ],
  previousTotals: [1049, 1068, 1052, 1075],
};

function fridayRush(): Scenario {
  const t = timeline("fr");
  t.add("bank.synced", "bank", at(6, 0), { balance: 38420 }, "Bank feed synced. Nothing new for tonight.", { routine: true });
  t.add(
    "schedule.published",
    "schedule",
    at(7, 30),
    {
      shifts: [
        shift("ana", "Ana", at(16, 30), at(23, 0)),
        shift("luis", "Luis", at(17, 0), at(23, 0)),
        shift("priya", "Priya", at(17, 0), at(23, 0)),
        shift("tom", "Tom", at(17, 30), at(23, 30)),
        shift("dee", "Dee", at(17, 30), at(22, 30)),
      ],
      onCall: { id: "sam", name: "Sam" },
    },
    "Schedule v3: 5 servers tonight, Sam on call.",
  );
  t.heartbeat("events", at(8, 0), "No events listed within a mile.");
  t.heartbeat("staff", at(9, 0), "No messages from the team.");
  t.heartbeat("suppliers", at(9, 30), "No new supplier mail.");
  t.add("inventory.expected", "inventory", at(10, 15), { item: "burrata", onHand: 32 }, "Receiving: 32 burrata expected on the line.");
  t.add("inventory.expected", "inventory", at(10, 15), { item: "branzino", onHand: 22 }, "Receiving: 22 branzino expected on the line.");
  t.add("reservations.updated", "reservations", at(11, 0), { covers: 131, system: "book" }, "Book: 131 covers.");
  t.heartbeat("reservations", at(12, 0), "Reservations synced. No change.");
  t.heartbeat("reservations", at(13, 0), "Reservations synced. No change.");
  t.heartbeat("reservations", at(14, 0), "Reservations synced. No change.");
  t.add("reservations.updated", "reservations", at(15, 30), { covers: 138, system: "book" }, "Book: 138 covers.");
  t.add("sales.updated", "pos", at(16, 15), { soFar: 205, planSoFar: 200 }, "Bar sales on plan.", { routine: true });
  t.add("sales.updated", "pos", at(16, 30), { soFar: 380, planSoFar: 370 }, "Bar sales on plan.", { routine: true });
  t.heartbeat("inventory", at(16, 40), "Receiving closed for the day.");
  t.add("sales.updated", "pos", at(16, 45), { soFar: 548, planSoFar: 540 }, "Bar sales on plan.", { routine: true });
  t.add("sales.updated", "pos", at(17, 0), { soFar: 712, planSoFar: 700 }, "Sales on plan.", { routine: true });

  // From here the owner is watching.
  t.add("sales.updated", "pos", at(17, 15), { soFar: 851, planSoFar: 830 }, "Sales on plan.", { routine: true });
  t.add(
    "event.listed",
    "events",
    at(17, 19),
    { name: "Concert at the green", endsAt: at(21, 15), distanceMi: 0.3, extraWalkIns: 12 },
    "Concert at the green, 0.3 mi away, ends 9:15 PM.",
  );
  t.add("invoice.received", "suppliers", at(17, 24), VALLEY_FRIDAY, "Greenline Produce invoice VP-20931: $1,183.", {
    dedupeKey: "invoice:valley-produce:VP-20931",
  });
  t.add("sales.updated", "pos", at(17, 30), { soFar: 1004, planSoFar: 958 }, "Sales slightly ahead of plan.", { routine: true });
  t.add("staff.callout", "staff", at(17, 31), { shiftId: "tom" }, "Tom called out of the 5:30 PM shift.", {
    dedupeKey: "callout:tom:fri",
  });
  t.add("staff.callout", "staff", at(17, 33), { shiftId: "tom" }, "Tom called out of the 5:30 PM shift.", {
    dedupeKey: "callout:tom:fri",
    occurredAt: at(17, 31),
  });
  t.add("inventory.count", "inventory", at(17, 36), { item: "burrata", place: "line", onHand: 31, reportedBy: "system" }, "Line count: 31 burrata.");
  t.add("inventory.count", "inventory", at(17, 36), { item: "branzino", place: "line", onHand: 22, reportedBy: "system" }, "Line count: 22 branzino.");
  t.add("inventory.count", "inventory", at(17, 36), { item: "branzino", place: "backup", onHand: 0, reportedBy: "system" }, "Walk-in: no backup branzino.");
  t.add("reservations.updated", "reservations", at(17, 38), { covers: 164, system: "book" }, "Book: 164 covers.");
  t.add("sales.updated", "pos", at(17, 41), { soFar: 1180, planSoFar: 1083 }, "Sales since open: $1,180 against $1,083 planned.");

  return {
    id: "friday_rush",
    title: "Friday rush",
    tagline: "Demand spikes and a server calls out.",
    day: "Friday",
    service: "Friday dinner",
    openAt: at(17, 12),
    burstFrom: at(17, 13),
    decideAt: at(17, 42),
    doorsAt: at(18, 0),
    closeAt: at(23, 0),
    plan: { covers: 126, sales: 9400, wages: 2538, walkIns: 30, peakWalkIns: 14, tomorrowCovers: 172, weeklyCash: 14860, cashFloor: 8000 },
    items: {
      burrata: { name: "Burrata", mix: 0.22, unitCost: 6.5, standing: 27, truth: { line: 31, backup: 8 } },
      branzino: { name: "Branzino", mix: 0.16, unitCost: 14, standing: 22, truth: { line: 22, backup: 0 } },
    },
    onCallAccepts: true,
    managerObjection: "The host can take section 4 for the first turn. We don't need Sam.",
    events: t.events,
  };
}

/* ------------------------------------------------------------------ */
/* Supplier problem: a short delivery, a price rise, a count that's off */
/* ------------------------------------------------------------------ */

const CASEIFICIO: Invoice = {
  vendor: "Caseificio Rossi",
  number: "CR-4471",
  period: "Week 40",
  lines: [
    { item: "Burrata, each", qty: 24, usualQty: 24, unitPrice: 7.67, contractPrice: 6.5 },
    { item: "Stracciatella, tub", qty: 6, usualQty: 6, unitPrice: 9.4, contractPrice: 8 },
  ],
  previousTotals: [201, 206, 199, 204],
};

function supplierProblem(): Scenario {
  const t = timeline("sp");
  t.add("bank.synced", "bank", at(6, 0), { balance: 36900 }, "Bank feed synced. Nothing new for tonight.", { routine: true });
  t.add(
    "schedule.published",
    "schedule",
    at(7, 30),
    {
      shifts: [
        shift("ana", "Ana", at(16, 30), at(22, 30)),
        shift("luis", "Luis", at(17, 0), at(22, 30)),
        shift("priya", "Priya", at(17, 0), at(22, 30)),
        shift("tom", "Tom", at(17, 0), at(22, 0)),
        shift("dee", "Dee", at(17, 30), at(22, 0)),
      ],
      onCall: { id: "sam", name: "Sam" },
    },
    "Schedule v2: 5 servers tonight, Sam on call.",
  );
  t.heartbeat("events", at(8, 0), "No events listed within a mile.");
  t.heartbeat("staff", at(9, 0), "No messages from the team.");
  t.add("inventory.expected", "inventory", at(10, 0), { item: "burrata", onHand: 26 }, "Receiving: 26 burrata expected on the line.");
  t.add("reservations.updated", "reservations", at(11, 0), { covers: 116, system: "book" }, "Book: 116 covers.");
  t.heartbeat("reservations", at(12, 0), "Reservations synced. No change.");
  t.heartbeat("reservations", at(13, 0), "Reservations synced. No change.");
  t.add("reservations.updated", "reservations", at(14, 0), { covers: 118, system: "book" }, "Book: 118 covers.");
  t.add("sales.updated", "pos", at(15, 15), { soFar: 140, planSoFar: 135 }, "Bar sales on plan.", { routine: true });
  t.add("sales.updated", "pos", at(15, 30), { soFar: 262, planSoFar: 255 }, "Bar sales on plan.", { routine: true });
  t.add("sales.updated", "pos", at(15, 45), { soFar: 371, planSoFar: 360 }, "Bar sales on plan.", { routine: true });

  t.heartbeat("suppliers", at(15, 50), "Supplier mail checked.");
  t.add(
    "delivery.received",
    "suppliers",
    at(15, 56),
    { vendor: "Greenline Produce", item: "greens", ordered: 10, received: 6, unitCost: 52, portionsPerUnit: 10 },
    "Greenline Produce delivered 6 of 10 cases of greens.",
  );
  t.add("inventory.count", "inventory", at(15, 57), { item: "greens", place: "line", onHand: 60, reportedBy: "system" }, "Receiving posted: 60 portions of greens.");
  t.add("inventory.count", "inventory", at(15, 57), { item: "greens", place: "backup", onHand: 0, reportedBy: "system" }, "Walk-in: no backup greens. The delivery was everything.");
  t.add("sales.updated", "pos", at(16, 0), { soFar: 478, planSoFar: 470 }, "Sales on plan.", { routine: true });
  t.add("invoice.received", "suppliers", at(16, 3), CASEIFICIO, "Caseificio Rossi invoice CR-4471: $240.", {
    dedupeKey: "invoice:caseificio-rossi:CR-4471",
  });
  t.add("inventory.count", "inventory", at(16, 9), { item: "burrata", place: "line", onHand: 12, reportedBy: "system" }, "Line count: 12 burrata.");
  t.heartbeat("reservations", at(16, 14), "Reservations synced. No change.");
  t.add("sales.updated", "pos", at(16, 17), { soFar: 640, planSoFar: 620 }, "Sales since open: $640 against $620 planned.");

  return {
    id: "supplier_problem",
    title: "Supplier problem",
    tagline: "A short delivery, a price rise, and a count that doesn't add up.",
    day: "Thursday",
    service: "Thursday dinner",
    openAt: at(15, 48),
    burstFrom: at(15, 49),
    decideAt: at(16, 18),
    doorsAt: at(17, 0),
    closeAt: at(22, 30),
    plan: { covers: 120, sales: 7600, wages: 2310, walkIns: 22, peakWalkIns: 10, tomorrowCovers: 110, weeklyCash: 11200, cashFloor: 8000 },
    items: {
      greens: { name: "Greens", mix: 0.55, unitCost: 5.2, standing: 60, truth: { line: 60, backup: 0 } },
      burrata: { name: "Burrata", mix: 0.2, unitCost: 6.5, standing: 20, truth: { line: 25, backup: 0 } },
    },
    onCallAccepts: true,
    managerObjection: "We're fine on the floor tonight.",
    events: t.events,
  };
}

/* ------------------------------------------------------------------ */
/* Slow night: bookings fall, labor is heavy, cash is tight             */
/* ------------------------------------------------------------------ */

const VALLEY_TUESDAY: Invoice = {
  vendor: "Greenline Produce",
  number: "VP-20977",
  period: "Week 41",
  lines: [
    { item: "Tomatoes, case", qty: 4, usualQty: 4, unitPrice: 38, contractPrice: 38 },
    { item: "Mixed greens, case", qty: 6, usualQty: 6, unitPrice: 52, contractPrice: 52 },
    { item: "Lemons, case", qty: 3, usualQty: 3, unitPrice: 30, contractPrice: 30 },
  ],
  previousTotals: [554, 560, 548, 556],
};

function slowNight(): Scenario {
  const t = timeline("sn");
  t.add("bank.synced", "bank", at(6, 0), { balance: 22180 }, "Bank feed synced.", { routine: true });
  t.add(
    "schedule.published",
    "schedule",
    at(7, 30),
    {
      shifts: [
        shift("ana", "Ana", at(16, 30), at(22, 0)),
        shift("luis", "Luis", at(17, 0), at(22, 0)),
        shift("priya", "Priya", at(17, 0), at(22, 0)),
        shift("dee", "Dee", at(17, 30), at(22, 0)),
      ],
      onCall: null,
    },
    "Schedule v1: 4 servers tonight.",
  );
  t.heartbeat("events", at(8, 0), "No events listed within a mile.");
  t.heartbeat("staff", at(9, 0), "No messages from the team.");
  t.heartbeat("suppliers", at(9, 30), "No new supplier mail.");
  t.add("inventory.expected", "inventory", at(10, 0), { item: "burrata", onHand: 30 }, "Receiving: 30 burrata expected on the line.");
  t.add("reservations.updated", "reservations", at(11, 0), { covers: 92, system: "book" }, "Book: 92 covers.");
  t.heartbeat("reservations", at(13, 0), "Reservations synced. No change.");
  t.add("sales.updated", "pos", at(16, 0), { soFar: 148, planSoFar: 150 }, "Bar sales on plan.", { routine: true });
  t.add("sales.updated", "pos", at(16, 15), { soFar: 236, planSoFar: 240 }, "Bar sales on plan.", { routine: true });
  t.add("sales.updated", "pos", at(16, 30), { soFar: 318, planSoFar: 330 }, "Bar sales on plan.", { routine: true });

  t.add("sales.updated", "pos", at(16, 45), { soFar: 352, planSoFar: 400 }, "Bar sales slipping.", { routine: true });
  t.add("reservations.updated", "reservations", at(16, 47), { covers: 74, system: "book" }, "Book: 74 covers. 18 cancellations since noon.");
  t.add("invoice.received", "suppliers", at(16, 52), VALLEY_TUESDAY, "Greenline Produce invoice VP-20977: $570.", {
    dedupeKey: "invoice:valley-produce:VP-20977",
  });
  t.add("reservations.updated", "reservations", at(16, 58), { covers: 61, system: "book" }, "Book: 61 covers. Rain is moving in.");
  t.add("sales.updated", "pos", at(17, 0), { soFar: 371, planSoFar: 455 }, "Sales behind plan.", { routine: true });
  t.add("inventory.count", "inventory", at(17, 4), { item: "burrata", place: "line", onHand: 30, reportedBy: "system" }, "Line count: 30 burrata.");
  t.add("sales.updated", "pos", at(17, 10), { soFar: 410, planSoFar: 520 }, "Sales since open: $410 against $520 planned.");

  return {
    id: "slow_night",
    title: "Slow night",
    tagline: "Bookings fall, too much labor is scheduled, and cash is tight.",
    day: "Tuesday",
    service: "Tuesday dinner",
    openAt: at(16, 42),
    burstFrom: at(16, 43),
    decideAt: at(17, 12),
    doorsAt: at(17, 30),
    closeAt: at(22, 0),
    plan: {
      covers: 92,
      sales: 6100,
      wages: 1880,
      walkIns: 12,
      peakWalkIns: 6,
      tomorrowCovers: 104,
      weeklyCash: 8420,
      cashFloor: 8000,
      deferrable: { label: "Thursday's dry-goods order", amount: 640, to: "Monday" },
    },
    items: {
      burrata: { name: "Burrata", mix: 0.22, unitCost: 6.5, standing: 24, truth: { line: 30, backup: 6 } },
    },
    onCallAccepts: false,
    managerObjection: "I'd rather keep everyone. Rain could bring walk-ins.",
    events: t.events,
  };
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  friday_rush: fridayRush(),
  supplier_problem: supplierProblem(),
  slow_night: slowNight(),
};

export const SCENARIO_ORDER: ScenarioId[] = ["friday_rush", "supplier_problem", "slow_night"];

import type { Minutes } from "@/domain/clock";
import type { ConfidenceLevel } from "@/domain/types";
import { HOUSE } from "@/domain/venue";
import { clock, lowerFirst, one, pct, plural, signedPct, signedUsd, usd } from "./format";
import { relevantPatterns } from "./memory";
import { SOURCES } from "./sources";
import { lastServerIn } from "./sort";
import { ADDED_SHIFT, EARLY_OUT_AT, PEAK_SLOT_SHARE, peakCoversFor, type TwinCore } from "./twin";
import type {
  CashLine,
  Decision,
  DecisionKey,
  EvidenceRef,
  HumanAct,
  InventoryLine,
  ManagerRequest,
  Observation,
  Reading,
  Scenario,
  Twin,
} from "./types";

/*
 * PLAN and GUARD. Specialists read the twin and say what they see. Decisions
 * are built from those readings, each with its evidence, what it doesn't
 * know, who can approve it and what Savy may and may not do about it.
 */

export interface PlanInput {
  twin: TwinCore;
  scenario: Scenario;
  human: Partial<Record<DecisionKey, HumanAct>>;
  requests: ManagerRequest[];
}

export interface Plan {
  twin: Twin;
  observations: Observation[];
  decisions: Decision[];
}

/** Order closes at this time the night before delivery. */
const VENDOR_CUTOFF: Minutes = 21 * 60;

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function evidence(r: Reading<unknown> | null, label: string, value: string): EvidenceRef[] {
  if (!r) return [];
  return [{ eventId: r.eventId, source: r.source, label, value, basis: r.basis, freshness: r.freshness, at: r.at }];
}

const GUARD_RULES = {
  labor: "GRD-LABOR · a labor change beyond the published schedule needs the owner",
  staleSales: "GRD-SALES · no labor change is priced on stale sales",
  covers: "GRD-COVERS · nothing that depends on covers runs on a disputed count",
  counts: "GRD-COUNT · counts come from people or systems, never estimates",
  orders: "GRD-ORDER · orders are drafted; Savy never submits them",
  money: "GRD-MONEY · Savy never moves, pays or disputes money",
  messages: "GRD-MSG · Savy prepares messages; a person sends them",
} as const;

function guard(requiresApproval: boolean, evidenceSufficient: boolean, rules: string[]): Decision["guard"] {
  return { requiresApproval, evidenceSufficient, externalActionAllowed: false, rules };
}

/**
 * A person's act on a decision is the last word on its status. An approval
 * is of the action as it stood, so the decision keeps showing that action
 * even if the evidence later moves what Savy would draft now.
 */
function withHuman(d: Decision, act: HumanAct | undefined): Decision {
  if (!act) return d;
  if (act.kind === "approved") {
    // A decided decision offers no more fixes. If the evidence moved after the approval, the card says that
    // instead of repeating a withdrawn headline next to an "Approved" chip.
    const drifted = d.recommendation?.action !== act.action;
    return {
      ...d,
      status: "approved",
      headline: drifted ? "Approved earlier. The evidence behind it has changed since." : d.headline,
      recommendation: drifted ? { action: act.action, detail: "Approved earlier, as it was drafted then.", approvable: false } : d.recommendation,
      remedies: [],
    };
  }
  return { ...d, status: "rejected" };
}

/* ------------------------------------------------------------------ */
/* Labor                                                               */
/* ------------------------------------------------------------------ */

/** `backing` is the surge pattern from memory when it is trusted, so the reason quotes its real record. */
function laborDecision(t: TwinCore, s: Scenario, backing: { held: number; nights: number } | null): Decision | null {
  const memoryBacked = backing !== null;
  const { demand, staffing, labor, sales } = t;
  const booked = demand.booked;
  const schedule = t.staffing.scheduled;
  if (!booked || schedule.length === 0) return null;

  const servers = staffing.servers;
  const callout = staffing.calledOut[0];
  const changed: string[] = [];
  if (demand.vsPlanPct !== null && Math.abs(demand.vsPlanPct) >= 10) {
    changed.push(`Reservations are at ${booked.value} covers, ${signedPct(demand.vsPlanPct)} against the plan of ${demand.planCovers}.`);
  }
  if (callout) changed.push(`${callout.name} called out of the ${clock(callout.start)} shift. ${schedule.length} servers became ${servers}.`);

  const base = {
    domain: "labor" as const,
    lane: "now" as const,
    authority: { role: "Owner" as const, why: "A labor change beyond the published schedule is the owner's call." },
    permissions: {
      can: ["Price the shift", "Draft the schedule change", "Prepare the message for the manager to send"],
      cannot: ["Publish the schedule", "Message staff", "Approve labor"],
    },
  };
  const ev: EvidenceRef[] = [
    ...evidence(booked, "Covers booked", `${booked.value}`),
    ...staffing.calloutRefs.map((r): EvidenceRef => {
      const who = staffing.calledOut.find((c) => c.id === r.shiftId);
      return {
        eventId: r.eventId,
        source: "staff",
        label: "Call-out",
        value: `${who?.name ?? "A server"}, ${clock(who?.start ?? r.at)}`,
        basis: "actual",
        freshness: "fresh",
        at: r.at,
      };
    }),
    ...evidence(sales, "Sales since open", sales ? `${usd(sales.value.soFar)} against ${usd(sales.value.planSoFar)}` : "—"),
  ];

  // Two counts disagree: the answer depends on which is right, and Savy won't pick.
  if (demand.disputed) {
    const a = booked.value;
    const b = demand.disputed.value;
    const peakA = peakCoversFor(a, s.plan.peakWalkIns);
    const peakB = peakCoversFor(b, s.plan.peakWalkIns);
    return {
      ...base,
      key: "staffing",
      id: "DEC-STAFF",
      status: "conflict",
      title: "Cover count in dispute",
      headline: "Two cover counts disagree, and the answer depends on which is right.",
      whatChanged: [`The book says ${a}. The host stand says ${b}.`, ...changed.slice(1)],
      whyItMatters: `At ${a}, each of ${servers} servers carries about ${one(peakA / servers)} covers at the peak. At ${b}, about ${one(peakB / servers)}. ${disputeVerdict(peakA / servers, peakB / servers, staffing.ceiling, staffing.floor)}`,
      recommendation: null,
      stillUnknown: ["Which count is right. Savy won't choose between them."],
      wouldChangeMind: ["The host confirming tonight's count settles it either way."],
      autonomy: "observe",
      guard: guard(true, false, [GUARD_RULES.covers, GUARD_RULES.labor]),
      doNothing: disputeDoNothing(peakA / servers, peakB / servers, staffing.ceiling),
      effects: [],
      evidence: [...ev, ...evidence(demand.disputed, "Host stand count", `${b}`)],
      confidence: { level: "none", reasons: ["The answer depends on a count Savy can't settle."] },
      urgency: { by: ADDED_SHIFT.start, label: `Before ${clock(ADDED_SHIFT.start)}` },
      remedies: [{ kind: "resolve_covers", label: "Settle the count" }],
      explain: {
        owner: "Your two reservation systems disagree. Tell me which count is right and I'll finish the plan.",
        gm: "Ask the host to confirm tonight's covers against the book.",
        engineering: [
          `conflict: reservations.book=${a} vs reservations.host=${b} (> ${COVER_TOLERANCE_PCT}% apart)`,
          "dependents held: staffing, inventory forecasts, purchasing",
          "guard: evidence_sufficient=false · requires_owner_approval=true · external_action_allowed=false",
        ],
      },
    };
  }

  const peak = staffing.peakLoad;
  if (peak === null || servers === 0) return null;
  const peakAtPlan = (t.demand.peakCovers ?? 0) / servers;
  const over = peakAtPlan > staffing.ceiling;
  const under = peakAtPlan < staffing.floor && (labor.pct === null || labor.pct > labor.goalPct);
  if (!over && !under) return null;

  // Sales are stale: the risk stays, the priced conclusion goes.
  if (!sales || sales.freshness !== "fresh") {
    const age = sales ? t.clock - sales.at : null;
    return {
      ...base,
      key: "staffing",
      id: "DEC-STAFF",
      status: "held",
      title: over ? "Coverage looks short" : "Floor looks heavy",
      headline: over ? "Coverage looks short. I can't price the fix yet." : "You may have more floor than the night needs. I can't price it yet.",
      whatChanged: changed,
      whyItMatters: over
        ? `At the 7 PM peak each server carries about ${one(peakAtPlan)} covers an hour. Your floor has held at ${staffing.ceiling} or fewer.`
        : `At the peak each server carries about ${one(peakAtPlan)} covers an hour, under the ${staffing.floor} where the floor stays busy.`,
      recommendation: {
        action: "Refresh sales before changing labor",
        detail: `Sales data is ${age === null ? "missing" : `${age} minutes old`}. I can explain the coverage risk, but I don't have current evidence to recommend paying for ${over ? "more" : "less"} labor.`,
        approvable: false,
      },
      stillUnknown: ["Tonight's sales pace, so the labor cost against your goal can't be computed."],
      wouldChangeMind: ["A current POS sync puts the recommendation back."],
      autonomy: "recommend",
      guard: guard(true, false, [GUARD_RULES.staleSales, GUARD_RULES.labor]),
      doNothing: over ? "The coverage risk is the same whether or not sales are current." : "Wages run ahead of a slow night.",
      effects: [{ label: "Peak covers per server", from: one(peakAtPlan), to: one(over ? staffing.loadWithOneMore ?? peak : peakAtPlan), basis: "estimated" }],
      evidence: ev,
      confidence: { level: "low", reasons: [`Sales are ${age === null ? "missing" : `${age} minutes old`}.`] },
      urgency: { by: ADDED_SHIFT.start, label: `Before ${clock(ADDED_SHIFT.start)}` },
      remedies: [{ kind: "recheck_pos", label: "Re-check POS" }],
      explain: {
        owner: over ? "You look one server short, but I can't price it until sales sync." : "You may be overstaffed, but I can't price it until sales sync.",
        gm: "Keep the floor as scheduled until sales refresh.",
        engineering: [
          `peak_load=${one(peakAtPlan)} ceiling=${staffing.ceiling} floor=${staffing.floor}`,
          `pos.sales freshness=${sales?.freshness ?? "missing"} age=${age ?? "—"}min (SLA ${SOURCES.pos.staleAfterMin}min)`,
          "guard: evidence_sufficient=false · requires_owner_approval=true · external_action_allowed=false",
        ],
      },
    };
  }

  const projected = labor.projectedSales ?? 0;
  const goal = labor.goalPct;

  if (over) {
    const onCall = staffing.onCall;
    const cost = ((ADDED_SHIFT.end - ADDED_SHIFT.start) / 60) * HOUSE.serverRate;
    const wagesNow = labor.wages - (staffing.added.length ? cost : 0);
    const pctNow = (wagesNow / projected) * 100;
    const pctAfter = ((wagesNow + cost) / projected) * 100;
    const window = `${clock(ADDED_SHIFT.start).replace(" PM", "")}–${clock(ADDED_SHIFT.end)}`;
    // peakCoversFor solved for the book: the most covers that keep these servers at the ceiling.
    const maxBooked = Math.floor((staffing.ceiling * servers - s.plan.peakWalkIns) / (2 * PEAK_SLOT_SHARE));
    const reasons = ["Reservations, the call-out and sales are current.", "Peak share and walk-ins come from sample history."];
    if (backing) reasons.push(`One added server has held the floor on ${backing.held} of ${backing.nights} nights like this.`);
    const level: ConfidenceLevel = memoryBacked ? "high" : "medium";
    return {
      ...base,
      key: "staffing",
      id: "DEC-STAFF",
      status: "recommend",
      title: "Cover the 7 PM peak",
      headline: "Your labor looks healthy. Your coverage does not.",
      whatChanged: changed,
      whyItMatters: `At the 7 PM peak each server carries about ${one(peakAtPlan)} covers an hour. Your floor has held at ${staffing.ceiling} or fewer. Labor projects to ${pct(pctNow)} against your ${goal}% goal, and the call-out is part of why it looks that good.`,
      recommendation: onCall
        ? {
            action: `Offer ${window} to ${onCall.name}, on call`,
            detail: `One more server brings the peak to about ${one(staffing.loadWithOneMore ?? peak)} covers each. About ${usd(cost)} in wages.`,
            approvable: true,
          }
        : { action: "Ask the manager who can pick up the peak", detail: "Nobody is on call tonight.", approvable: false },
      stillUnknown: [
        `Whether ${onCall?.name ?? "anyone"} says yes. Savy prepares the message; the manager sends it.`,
        ...(demand.nearbyEvent ? [`Walk-ins after the ${clock(demand.nearbyEvent.value.endsAt)} concert. Listed, not verified, not counted.`] : []),
      ],
      wouldChangeMind: [
        `If the book drops to ${maxBooked} covers or fewer, ${servers} servers stay under ${staffing.ceiling} at the peak.`,
        "If current sales stop arriving, I hold the labor recommendation.",
        "If the manager knows the floor can cover a section, that outranks my arithmetic.",
      ],
      autonomy: "prepare",
      guard: guard(true, true, [GUARD_RULES.labor, GUARD_RULES.messages]),
      doNothing: `${servers} servers carry the 7 PM wave at about ${one(peakAtPlan)} covers each. Tickets stretch and some walk-ins leave.`,
      effects: [
        { label: "Peak covers per server", from: one(peakAtPlan), to: one(staffing.loadWithOneMore ?? peak), basis: "estimated" },
        { label: "Wages tonight", from: usd(wagesNow), to: usd(wagesNow + cost), basis: "scheduled" },
        { label: "Labor", from: pct(pctNow), to: pct(pctAfter), basis: "estimated" },
      ],
      evidence: ev,
      confidence: { level, reasons },
      urgency: { by: ADDED_SHIFT.start, label: `Before ${clock(ADDED_SHIFT.start)}` },
      remedies: [],
      explain: {
        owner: `You're one server short for the 7 PM peak. Bring ${onCall?.name ?? "someone"} in for ${window}.`,
        gm: `Call ${onCall?.name ?? "the on-call server"} for ${window} and give them section 4. Seat the 7 PM wave across ${servers + 1} sections.`,
        engineering: [
          `rule LAB-COV-01: peak_load ${one(peakAtPlan)} > ceiling ${staffing.ceiling}`,
          `peak_covers/h = (${booked.value} × ${PEAK_SLOT_SHARE} + ${s.plan.peakWalkIns} ÷ 2) × 2 = ${one(t.demand.peakCovers ?? 0)}`,
          `labor_pct = ${usd(wagesNow)} ÷ ${usd(projected)} = ${pct(pctNow)} (goal ${goal}%)`,
          "guard: evidence_sufficient=true · requires_owner_approval=true · external_action_allowed=false",
        ],
      },
    };
  }

  // Under the floor and over the labor goal: offer an early out after the peak.
  const working = staffing.scheduled.filter((x) => !staffing.calledOut.some((c) => c.id === x.id));
  const lastIn = lastServerIn(working);
  if (!lastIn) return null;
  const savings = ((lastIn.end - EARLY_OUT_AT) / 60) * HOUSE.serverRate;
  const wagesNow = labor.wages + (staffing.cut.length ? savings : 0);
  const pctNow = (wagesNow / projected) * 100;
  const pctAfter = ((wagesNow - savings) / projected) * 100;
  return {
    ...base,
    key: "staffing",
    id: "DEC-STAFF",
    status: "recommend",
    title: "Too much floor for the night",
    headline: "Bookings fell. You have more floor than tonight needs.",
    whatChanged: changed,
    whyItMatters: `At the peak each server carries about ${one(peakAtPlan)} covers, under the ${staffing.floor} where the floor stays busy. Labor projects to ${pct(pctNow)} against your ${goal}% goal.`,
    recommendation: {
      action: `Offer ${lastIn.name} an early out at ${clock(EARLY_OUT_AT)}`,
      detail: `After the peak. Voluntary. Saves about ${usd(savings)} in wages. ${servers - 1} servers still carry under ${staffing.ceiling} each.`,
      approvable: true,
    },
    stillUnknown: ["Walk-ins in the rain. Sample history says few."],
    wouldChangeMind: [`If walk-ins pass ${s.plan.peakWalkIns * 2} by 7 PM, keep everyone.`, `A slow ${s.day} can't reach ${goal}% by cutting one server; the rest is the sales shortfall.`],
    autonomy: "prepare",
    guard: guard(true, true, [GUARD_RULES.labor, GUARD_RULES.messages]),
    doNothing: `${servers} servers share a night that needs fewer. Wages run about ${usd(savings)} ahead of where they need to be.`,
    effects: [
      { label: "Wages tonight", from: usd(wagesNow), to: usd(wagesNow - savings), basis: "scheduled" },
      { label: "Labor", from: pct(pctNow), to: pct(pctAfter), basis: "estimated" },
    ],
    evidence: ev,
    confidence: { level: "medium", reasons: ["Reservations and sales are current.", "Walk-ins come from sample history."] },
    urgency: { by: EARLY_OUT_AT, label: `Before ${clock(EARLY_OUT_AT)}` },
    remedies: [],
    explain: {
      owner: `You're overstaffed for a slow night. Offer ${lastIn.name} an early out at ${clock(EARLY_OUT_AT)}.`,
      gm: `Ask ${lastIn.name} at the 7:30 check-in whether they'd like to leave at 8. Fold their section into Priya's.`,
      engineering: [
        `rule LAB-UNDER-01: peak_load ${one(peakAtPlan)} < floor ${staffing.floor} and labor ${pct(pctNow)} > goal ${goal}%`,
        `savings = ${(lastIn.end - EARLY_OUT_AT) / 60} h × $${HOUSE.serverRate} = ${usd(savings)}`,
        "guard: evidence_sufficient=true · requires_owner_approval=true · external_action_allowed=false",
      ],
    },
  };
}

const COVER_TOLERANCE_PCT = 5;

/** What two disputed cover counts mean for the floor, said only as far as it is true. */
function disputeVerdict(loadA: number, loadB: number, ceiling: number, floor: number): string {
  const overA = loadA > ceiling;
  const overB = loadB > ceiling;
  if (overA !== overB) return `One is over your ceiling of ${ceiling}, one isn't.`;
  if (overA) return `Both are over your ceiling of ${ceiling}; how much help to add depends on which is right.`;
  if ((loadA < floor) !== (loadB < floor)) return `One leaves the floor under-used, one doesn't.`;
  return `Both are inside your ceiling of ${ceiling}, but the forecast and tomorrow's order still depend on which is right.`;
}

function disputeDoNothing(loadA: number, loadB: number, ceiling: number): string {
  const overA = loadA > ceiling;
  const overB = loadB > ceiling;
  if (overA && !overB) return "If the book is right, the floor runs over its ceiling at 7 PM. If the host is right, it doesn't.";
  if (!overA && overB) return "If the host is right, the floor runs over its ceiling at 7 PM. If the book is right, it doesn't.";
  if (overA) return "Either way the floor runs over its ceiling at 7 PM.";
  return "The floor holds either way. The forecast and the order wait on the count.";
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

function inventoryDecision(t: TwinCore, s: Scenario, item: InventoryLine, requests: ManagerRequest[]): Decision | null {
  const spec = s.items[item.item];
  if (!spec) return null;
  const name = spec.name;
  const lower = name.toLowerCase();
  const key = `inventory:${item.item}`;
  const id = `DEC-${item.item.toUpperCase()}`;
  const asked = requests.find((r) => r.item === item.item && r.answeredAt === null);
  const base = {
    key,
    id,
    domain: "inventory" as const,
    authority: { role: "GM" as const, why: "Counting stock is the manager's job. Savy asks; the manager counts." },
    autonomy: "recommend" as const,
    permissions: { can: ["Forecast run-out from covers", "Ask the manager for a count"], cannot: ["Change a count", "86 a dish", "Order stock"] },
    evidence: [...evidence(item.line, `${name} on the line`, item.line ? `${item.line.value}` : "—"), ...evidence(item.backup, `${name} in backup`, item.backup ? `${item.backup.value}` : "—")],
  };
  const pending = asked ? ` Asked at ${clock(asked.askedAt)}; waiting for the manager.` : "";

  switch (item.status) {
    case "needs_count":
      return {
        ...base,
        lane: "missing_fact",
        status: "needs_fact",
        title: `No ${lower} count today`,
        headline: `I don't have a ${lower} count, so I won't forecast it.`,
        whatChanged: [`This afternoon's ${lower} count was never entered.`],
        whyItMatters: `Without a count there is no run-out time and no order for tomorrow. Unknown is not zero.`,
        recommendation: { action: "Ask the manager for a count", detail: `One number from the floor.${pending}`, approvable: false },
        stillUnknown: [`${name} on hand.`],
        wouldChangeMind: ["A count from the manager."],
        guard: guard(false, false, [GUARD_RULES.counts]),
        doNothing: `Nobody knows whether ${lower} lasts the night until a server hears "we're out".`,
        effects: [],
        confidence: { level: "none", reasons: ["No count."] },
        urgency: { by: s.doorsAt, label: `Before doors at ${clock(s.doorsAt)}` },
        remedies: asked ? [] : [{ kind: "ask_manager", item: item.item, place: "line", label: "Ask manager for a count" }],
        explain: {
          owner: `I need one number: today's ${lower} count.`,
          gm: `Count the ${lower} on the line and send me the number.`,
          engineering: [`inventory.count[${item.item}, line] missing`, "rule GRD-COUNT: no estimate substituted", "dependents held: run-out, purchasing line"],
        },
      };
    case "discrepancy":
      return {
        ...base,
        lane: "missing_fact",
        status: "needs_fact",
        title: `${name} count doesn't add up`,
        headline: `${item.line?.value} ${lower} counted. Receiving says ${item.expected}.`,
        whatChanged: [`The line count is ${item.line?.value}. Receiving expected ${item.expected}.`],
        whyItMatters: "Either stock is somewhere else or something went missing. The order for tomorrow depends on which.",
        recommendation: { action: "Ask the manager for a recount", detail: `Including the second walk-in.${pending}`, approvable: false },
        stillUnknown: [`Where the other ${(item.expected ?? 0) - (item.line?.value ?? 0)} are.`],
        wouldChangeMind: ["A recount that matches receiving closes this."],
        guard: guard(false, false, [GUARD_RULES.counts]),
        doNothing: `Tomorrow's order is built on a count that may be wrong by ${(item.expected ?? 0) - (item.line?.value ?? 0)}.`,
        effects: [],
        confidence: { level: "low", reasons: ["Two records disagree."] },
        urgency: { by: s.doorsAt, label: `Before doors at ${clock(s.doorsAt)}` },
        remedies: asked ? [] : [{ kind: "ask_manager", item: item.item, place: "line", label: "Ask manager to recount" }],
        explain: {
          owner: `The ${lower} count is off by ${(item.expected ?? 0) - (item.line?.value ?? 0)}. A recount settles it.`,
          gm: `Recount ${lower}, both walk-ins, and send me the number.`,
          engineering: [`inventory.count=${item.line?.value} vs inventory.expected=${item.expected} (> 25% apart)`, "purchasing line held until recount"],
        },
      };
    case "needs_backup_count":
      return {
        ...base,
        lane: "missing_fact",
        status: "needs_fact",
        title: `${name} may run short${item.runOutAt ? ` around ${clock(item.runOutAt)}` : ""}`,
        headline: `${item.line?.value} on the line, about ${item.forecast} orders expected tonight, and the walk-in hasn't been counted.`,
        whatChanged: [`Line count is ${item.line?.value} ${lower}.`, `${t.demand.booked?.value} covers booked means about ${item.forecast} ${lower} orders.`],
        whyItMatters: `${plural(item.exposure ?? 0, "portion")} of exposure. If the line runs out, the dish is 86'd in the second turn.`,
        recommendation: { action: "Check backup stock first", detail: `The walk-in hasn't been counted today. One count settles it before anything is ordered.${pending}`, approvable: false },
        stillUnknown: [`Backup ${lower} in the walk-in. Not counted today, and unknown is not zero.`],
        wouldChangeMind: [`If the walk-in has ${item.exposure} or more, there's nothing to do tonight.`, "If covers fall, the forecast falls with them."],
        guard: guard(false, false, [GUARD_RULES.counts, GUARD_RULES.orders]),
        doNothing: `The line runs out${item.runOutAt ? ` around ${clock(item.runOutAt)}` : ""} unless someone thinks to check the walk-in.`,
        effects: [{ label: `${name} short tonight`, from: `${item.exposure}`, to: "?", basis: "estimated" }],
        confidence: { level: "medium", reasons: ["The line count is current.", "The forecast uses the usual share of covers that order it."] },
        urgency: { by: s.doorsAt, label: `Before doors at ${clock(s.doorsAt)}` },
        remedies: asked ? [] : [{ kind: "ask_manager", item: item.item, place: "backup", label: "Ask manager to check stock" }],
        explain: {
          owner: `${name} might run out around ${item.runOutAt ? clock(item.runOutAt) : "the second turn"}. Have someone check the walk-in.`,
          gm: `Check the walk-in for ${lower} and send me the count.`,
          engineering: [
            `forecast = round(${t.demand.booked?.value} × ${spec.mix}) = ${item.forecast}`,
            `exposure = ${item.forecast} − ${item.line?.value} = ${item.exposure}`,
            `inventory.count[${item.item}, backup] missing → ask, don't assume 0 or par`,
          ],
        },
      };
    case "blocked": {
      const lineCount = item.line?.value ?? 0;
      const high = Math.max(t.demand.booked?.value ?? 0, t.demand.disputed?.value ?? 0);
      if (Math.round(high * spec.mix) <= lineCount) return null;
      return {
        ...base,
        lane: "now",
        status: "held",
        title: `${name} forecast held`,
        headline: `I can't say whether ${lower} lasts until the cover count is settled.`,
        whatChanged: ["The two reservation counts disagree."],
        whyItMatters: `At the higher count, ${lower} runs short. At the lower one, it doesn't.`,
        recommendation: null,
        stillUnknown: ["Which cover count is right."],
        wouldChangeMind: ["Settling the count."],
        guard: guard(false, false, [GUARD_RULES.covers]),
        doNothing: "It depends on which count is right.",
        effects: [],
        confidence: { level: "none", reasons: ["Depends on a disputed count."] },
        urgency: { by: s.doorsAt, label: `Before doors at ${clock(s.doorsAt)}` },
        remedies: [{ kind: "resolve_covers", label: "Settle the count" }],
        explain: {
          owner: "This waits on the same cover count as staffing.",
          gm: "Nothing to do until the host confirms covers.",
          engineering: ["forecast depends on reservations (disputed) → held, not estimated"],
        },
      };
    }
    case "short":
    case "ok": {
      // A count a person gave tonight either closes the question or turns it into a watch.
      if (item.backup?.basis !== "reported" && item.line?.basis !== "reported") return null;
      const onHand = (item.line?.value ?? 0) + (item.backup?.value ?? 0);
      if (item.status === "ok") {
        return {
          ...base,
          lane: "missing_fact",
          status: "resolved",
          title: `${name} covered`,
          headline: `${name} covered: ${onHand} on hand against ${item.forecast} forecast.`,
          whatChanged: [`The manager counted ${item.backup?.basis === "reported" ? `${item.backup.value} in backup` : `${item.line?.value} on the line`}.`],
          whyItMatters: "No shortfall tonight. Tomorrow's order was recomputed with the count.",
          recommendation: null,
          stillUnknown: [],
          wouldChangeMind: ["A jump in covers."],
          guard: guard(false, true, [GUARD_RULES.counts]),
          doNothing: "Nothing to do.",
          effects: [{ label: `${name} short tonight`, from: "?", to: "0", basis: "reported" }],
          confidence: { level: "high", reasons: ["Counted by the manager tonight."] },
          urgency: { by: null, label: "Closed by evidence" },
          remedies: [],
          explain: {
            owner: `${name} is fine. The walk-in covers it.`,
            gm: "No change.",
            engineering: [`exposure = ${item.forecast} − ${onHand} = ${item.exposure} ≤ 0 → resolved without action`],
          },
        };
      }
      return {
        ...base,
        lane: "can_wait",
        status: "recommend",
        title: `${name} will run short`,
        headline: `${name} runs out around ${item.runOutAt ? clock(item.runOutAt) : "the second turn"}, even with the walk-in.`,
        whatChanged: [`The manager counted ${item.backup?.value ?? 0} in backup. ${onHand} on hand against ${item.forecast}.`],
        whyItMatters: `${plural(item.exposure ?? 0, "portion")} short tonight. Tomorrow's order covers the rest.`,
        recommendation: { action: "Tell the floor to steer late tables to the special", detail: "Nothing on hand can cover it tonight.", approvable: true },
        stillUnknown: [],
        wouldChangeMind: ["Fewer covers than booked."],
        guard: guard(false, true, [GUARD_RULES.counts]),
        doNothing: `Servers find out it's gone when a guest orders it.`,
        effects: [{ label: `${name} short tonight`, from: "?", to: `${item.exposure}`, basis: "estimated" }],
        confidence: { level: "medium", reasons: ["Counted tonight. The forecast is estimated."] },
        urgency: { by: item.runOutAt, label: item.runOutAt ? `Before ${clock(item.runOutAt)}` : "Tonight" },
        remedies: [],
        explain: {
          owner: `${name} will run out late. The floor should know.`,
          gm: `Tell servers ${lower} is limited after ${item.runOutAt ? clock(item.runOutAt) : "9"}; push the special.`,
          engineering: [`exposure ${item.exposure} > 0 after backup → watch, no order tonight`],
        },
      };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Purchasing                                                          */
/* ------------------------------------------------------------------ */

function purchasingDecision(t: TwinCore, s: Scenario): Decision | null {
  const po = t.purchasing;
  if (po.lines.length === 0) return null;
  const adds = po.lines.filter((l) => l.qty > 0);
  const trims = po.lines.filter((l) => l.qty < 0);
  const described = po.lines.map((l) => `${l.name} ${l.qty > 0 ? "+" : "−"}${Math.abs(l.qty)}`).join(", ");
  const assumesNoBackup = t.inventory.filter((i) => i.backup === null && po.lines.some((l) => l.item === i.item && l.qty > 0));
  const held = t.inventory.filter((i) => i.status === "needs_count" || i.status === "discrepancy" || i.status === "blocked");
  const trimOnly = adds.length === 0;

  return {
    key: "purchasing",
    id: "DEC-PO",
    domain: "purchasing",
    lane: "now",
    status: "recommend",
    title: trimOnly ? "Trim tomorrow's standing order" : "Draft tomorrow's order",
    headline: trimOnly ? `Tomorrow's standing order is more than the night needs: ${described}.` : `Tomorrow's order needs ${described}.`,
    whatChanged: po.lines.map((l) => `${l.name}: ${l.why}`),
    whyItMatters: trimOnly
      ? `Trimming saves about ${usd(-po.total)} and keeps perishables from aging in the walk-in.`
      : `Without it, tomorrow starts short. The draft adds about ${usd(po.total)}.`,
    recommendation: {
      action: trimOnly ? "Approve the trimmed order" : "Approve the draft order",
      detail: "Draft only. Owner approval required. Savy can't send it to the vendor.",
      approvable: true,
    },
    stillUnknown: [
      ...assumesNoBackup.map((i) => `${i.name} assumes nothing in backup. It drops if the walk-in has stock.`),
      ...held.map((i) => `${i.name} isn't in this draft until it's counted.`),
    ],
    wouldChangeMind: ["A backup count, a cover change, or tomorrow's bookings moving."],
    authority: { role: "Owner", why: "Orders spend money. The owner approves, then submits." },
    autonomy: "prepare",
    permissions: { can: ["Calculate the order", "Draft the PO"], cannot: ["Submit to the vendor", "Change standing orders"] },
    guard: guard(true, true, [GUARD_RULES.orders, GUARD_RULES.money]),
    doNothing: trimOnly ? "The standing order arrives as is." : "Tomorrow opens short on the items below.",
    effects: [{ label: "Tomorrow's order", from: "$0", to: `${po.total < 0 ? "−" : "+"}${usd(po.total)}`, basis: "estimated" }],
    evidence: t.inventory.flatMap((i) => evidence(i.line, `${i.name} on the line`, i.line ? `${i.line.value}` : "—")),
    confidence: {
      level: assumesNoBackup.length ? "medium" : "high",
      reasons: assumesNoBackup.length ? ["One line assumes no backup stock."] : ["Every line is counted tonight."],
    },
    urgency: { by: VENDOR_CUTOFF, label: `Vendor cutoff ${clock(VENDOR_CUTOFF)}` },
    remedies: [],
    explain: {
      owner: trimOnly ? "Tomorrow's standing order is too big for this week. Trim it." : `Tomorrow needs ${described}. It's drafted; you approve and submit.`,
      gm: "Nothing for the floor.",
      engineering: [
        `qty = round(tomorrow_covers ${s.plan.tomorrowCovers} × mix × 1.1 − left_tonight − standing)`,
        ...po.lines.map((l) => `${l.item}: ${l.qty} × ${usd(l.unitCost)}`),
        "autonomy=prepare · submit requires owner · external_action_allowed=false",
      ],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Supply, invoices, events, cash                                      */
/* ------------------------------------------------------------------ */

function supplyDecisions(t: TwinCore, s: Scenario): Decision[] {
  return t.deliveries
    .filter((d) => d.short > 0)
    .map((d) => {
      const item = t.inventory.find((i) => i.item === d.item);
      const credit = d.short * d.unitCost;
      const onHand = item?.line?.value ?? d.received * d.portionsPerUnit;
      const lower = d.name.replace(/ \(.*\)$/, "").toLowerCase();
      return {
        key: `supply:${d.item}`,
        id: `DEC-${d.item.toUpperCase()}-SHORT`,
        domain: "supply" as const,
        lane: "now" as const,
        status: "recommend" as const,
        title: `${d.vendor} short-shipped ${lower}`,
        headline:
          item?.forecast != null
            ? `${d.received} of ${d.ordered} cases of ${lower} arrived. About ${item.forecast} portions needed, ${onHand} on hand.`
            : `${d.received} of ${d.ordered} cases of ${lower} arrived. ${onHand} portions on hand.`,
        whatChanged: [`${d.vendor} delivered ${d.received} of ${d.ordered} cases.`],
        whyItMatters: `The ${(s.items[d.item]?.name ?? lower).toLowerCase()} runs out late in the second turn, and ${d.short} cases (${usd(credit)}) are owed back.`,
        recommendation: {
          action: `Hold the salad at ${onHand} portions, then offer the arugula`,
          detail: `A credit request for ${d.short} cases (${usd(credit)}) is drafted for ${d.vendor}. Draft only; Savy can't send it.`,
          approvable: true,
        },
        stillUnknown: ["Whether the vendor can deliver the rest tomorrow."],
        wouldChangeMind: ["A second delivery before doors."],
        authority: { role: "Chef" as const, why: "The menu is the chef's call. The credit request is the owner's." },
        autonomy: "prepare" as const,
        permissions: { can: ["Draft the credit request", "Count portions against the forecast"], cannot: ["Email the vendor", "Change the menu"] },
        guard: guard(true, true, [GUARD_RULES.messages, GUARD_RULES.money]),
        doNothing: `The salad 86s mid-service and the ${usd(credit)} credit is forgotten by Monday.`,
        effects: [{ label: "Credit owed", from: "$0", to: usd(credit), basis: "expected" as const }],
        evidence: [{ eventId: d.eventId, source: "suppliers" as const, label: "Delivery", value: `${d.received} of ${d.ordered}`, basis: "actual" as const, freshness: "fresh" as const, at: null }],
        confidence: { level: "high" as ConfidenceLevel, reasons: ["The delivery record is current.", "Caseificio and Valley both short-ship sometimes; this one is on paper."] },
        urgency: { by: s.doorsAt, label: `Before doors at ${clock(s.doorsAt)}` },
        remedies: [],
        explain: {
          owner: `${lower} came in short. Cap the salad and claim the ${usd(credit)} credit.`,
          gm: `Tell the line: ${onHand} salads, then switch to arugula. Brief servers at lineup.`,
          engineering: [`delivery.short = ${d.ordered} − ${d.received} = ${d.short}`, `credit = ${d.short} × ${usd(d.unitCost)} = ${usd(credit)}`, "message drafted · external_action_allowed=false"],
        },
      };
    });
}

function invoiceDecisions(t: TwinCore): Decision[] {
  return t.invoices
    .filter((inv) => inv.verdict !== "in_line")
    .map((inv, i) => {
      const rose = inv.lines.filter((l) => l.unitPrice > l.contractPrice).map((l) => l.item.split(",")[0]!.toLowerCase());
      const verdictLine =
        inv.verdict === "price" ? "This looks like a price change, not more volume." : inv.verdict === "volume" ? "This looks like more volume, not a price change." : "Both prices and quantities moved.";
      return {
        key: inv.key,
        // Ids stay unique when a night brings more than one invoice.
        id: i === 0 ? "DEC-INVOICE" : `DEC-INVOICE-${i + 1}`,
        domain: "finance" as const,
        lane: "can_wait" as const,
        status: "deferred" as const,
        title: `${inv.vendor} invoice ${Math.round(inv.deltaPct)}% over contract`,
        headline: verdictLine,
        whatChanged: [
          `${usd(inv.total)} against ${usd(inv.contractTotal)} on contract, and ${usd(inv.previousAvg)} on average over the last four.`,
          inv.verdict === "price" ? `Quantities match the usual order. Unit prices rose on ${rose.join(", ")}.` : "Quantities changed against the usual order.",
          ...(inv.duplicatesSuppressed ? [`The same invoice arrived ${inv.duplicatesSuppressed + 1} times. It is counted once.`] : []),
        ],
        whyItMatters: `${signedUsd(inv.priceEffect)} this week from price alone. If it holds, about ${usd(inv.priceEffect * 52)} a year.`,
        recommendation: { action: "Review it on Monday", detail: "Nothing about tonight depends on it. Savy can flag it; it can't dispute or pay it.", approvable: true },
        stillUnknown: ["Whether the vendor changed the contract or made an error."],
        wouldChangeMind: ["A contract update from the vendor."],
        authority: { role: "Owner" as const, why: "Disputing or accepting a price change is the owner's call." },
        autonomy: "recommend" as const,
        permissions: { can: ["Compare against contract and history", "Flag for review"], cannot: ["Dispute the invoice", "Pay it", "Contact the vendor"] },
        guard: guard(true, true, [GUARD_RULES.money]),
        doNothing: "The higher price becomes the new normal without anyone deciding it should.",
        effects: [{ label: "This week's produce", from: usd(inv.contractTotal), to: usd(inv.total), basis: "actual" as const }],
        evidence: [{ eventId: inv.eventId, source: "suppliers" as const, label: `${inv.vendor} ${inv.number}`, value: usd(inv.total), basis: "actual" as const, freshness: "fresh" as const, at: null }],
        confidence: { level: "high" as ConfidenceLevel, reasons: ["Line by line against the contract."] },
        urgency: { by: null, label: "Monday" },
        remedies: [],
        explain: {
          owner: `${inv.vendor} raised prices about ${Math.round(inv.deltaPct)}%. Look at it Monday.`,
          gm: "Nothing for the floor.",
          engineering: [
            `price_effect = Σ qty × (unit − contract) = ${usd(inv.priceEffect)}`,
            `volume_effect = Σ (qty − usual) × contract = ${usd(inv.volumeEffect)}`,
            `verdict=${inv.verdict}${inv.duplicatesSuppressed ? ` · duplicates_suppressed=${inv.duplicatesSuppressed}` : ""}`,
          ],
        },
      };
    });
}

function eventDecision(t: TwinCore): Decision | null {
  const e = t.demand.nearbyEvent;
  if (!e) return null;
  return {
    key: "event",
    id: "DEC-EVENT",
    domain: "watch",
    lane: "can_wait",
    status: "watching",
    title: `${e.value.name} ends ${clock(e.value.endsAt)}`,
    headline: "Late walk-ins are possible. I'm watching, not counting.",
    whatChanged: [`${e.value.name}, ${e.value.distanceMi} mi away, ends at ${clock(e.value.endsAt)}.`],
    whyItMatters: "It could fill the second turn. It could also bring nobody.",
    recommendation: null,
    stillUnknown: ["How many walk-ins it brings. Listed, not verified."],
    wouldChangeMind: ["Walk-ins after 9 PM running ahead of a usual Friday."],
    authority: { role: "GM", why: "The manager sees the door." },
    autonomy: "observe",
    permissions: { can: ["Watch the listing and the door count"], cannot: ["Count it as demand"] },
    guard: guard(false, false, []),
    doNothing: "Nothing changes unless walk-ins arrive.",
    effects: [],
    evidence: evidence(e, "Listing", e.value.name),
    confidence: { level: "low", reasons: ["A public listing, not verified."] },
    urgency: { by: null, label: "Watching" },
    remedies: [],
    explain: {
      owner: "A concert nearby might send walk-ins late. Nothing to do yet.",
      gm: "If the door gets busy after 9, keep section 4 open.",
      engineering: ["event.listed basis=expected · counted=false · not in forecast"],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Cash                                                                */
/* ------------------------------------------------------------------ */

function cashOf(t: TwinCore, s: Scenario, decisions: Decision[]): Twin["cash"] {
  const lines: CashLine[] = [];
  const statusFor = (key: string): CashLine["status"] | null => {
    const d = decisions.find((x) => x.key === key);
    if (!d) return null;
    if (d.status === "approved") return "approved";
    if (d.status === "recommend") return "proposed";
    return null;
  };

  const staffing = statusFor("staffing");
  const staffDecision = decisions.find((d) => d.key === "staffing");
  if (staffing && staffDecision?.recommendation) {
    const cost = ((ADDED_SHIFT.end - ADDED_SHIFT.start) / 60) * HOUSE.serverRate;
    const isCut = staffDecision.recommendation.action.includes("early out");
    // The same server the decision names: the last one in among those actually working, not anyone who called out.
    const working = t.staffing.scheduled.filter((x) => !t.staffing.calledOut.some((c) => c.id === x.id));
    const lastIn = lastServerIn(working);
    const savings = lastIn ? ((lastIn.end - EARLY_OUT_AT) / 60) * HOUSE.serverRate : 0;
    lines.push({ label: staffDecision.recommendation.action, amount: isCut ? savings : -cost, status: staffing, decision: "staffing" });
  }
  const po = statusFor("purchasing");
  if (po && t.purchasing.total !== 0) {
    lines.push({ label: t.purchasing.total > 0 ? "Tomorrow's order additions" : "Tomorrow's order trimmed", amount: -t.purchasing.total, status: t.purchasing.status === "confirmed" ? "approved" : po, decision: "purchasing" });
  }
  for (const d of t.deliveries.filter((x) => x.short > 0)) {
    const st = statusFor(`supply:${d.item}`);
    if (st) lines.push({ label: `Credit request, ${d.vendor}`, amount: d.short * d.unitCost, status: st, decision: `supply:${d.item}` });
  }
  for (const inv of t.invoices.filter((i) => i.verdict === "price" || i.verdict === "both")) {
    lines.push({ label: `${inv.vendor} price change (${inv.number})`, amount: -inv.priceEffect, status: "realized", decision: inv.key });
  }
  if (t.labor.projectedSales !== null) {
    lines.push({ label: "Tonight's sales against plan, at the current pace", amount: t.labor.projectedSales - s.plan.sales, status: "estimated" as CashLine["status"], decision: null });
  }

  const sum = (pred: (l: CashLine) => boolean) => lines.filter(pred).reduce((n, l) => n + l.amount, 0);
  const baseline = s.plan.weeklyCash;
  const projected = baseline + sum((l) => l.status === "realized" || l.status === "approved");
  const proposedDelta = sum((l) => l.decision !== null && (l.status === "proposed" || l.status === "approved") && !l.decision.startsWith("invoice:"));
  return { baseline, floor: s.plan.cashFloor, lines, projected, proposedDelta, withEstimates: projected + sum((l) => (l.status as string) === "estimated") };
}

function cashDecision(t: TwinCore, s: Scenario, cash: Twin["cash"]): Decision | null {
  const deferrable = s.plan.deferrable;
  if (!deferrable || cash.withEstimates >= cash.floor) return null;
  const short = cash.floor - cash.withEstimates;
  return {
    key: "cash",
    id: "DEC-CASH",
    domain: "finance",
    lane: "can_wait",
    status: "recommend",
    title: "Weekly cash may dip under your floor",
    headline: `If tonight lands where it's pacing, weekly cash ends near ${usd(cash.withEstimates)}, under your ${usd(cash.floor)} floor.`,
    whatChanged: ["Tonight's sales are pacing well under plan."],
    whyItMatters: `About ${usd(short)} under the floor you set. It's timing, not a loss: the money is spent next week instead.`,
    recommendation: { action: `Move ${deferrable.label} (${usd(deferrable.amount)}) to ${deferrable.to}`, detail: "Nothing on it is needed before then.", approvable: true },
    stillUnknown: ["Where tonight actually lands. This uses the current pace."],
    wouldChangeMind: ["A strong second half tonight."],
    authority: { role: "Owner", why: "Timing payments is the owner's call." },
    autonomy: "recommend",
    permissions: { can: ["Project weekly cash", "Suggest timing"], cannot: ["Move money", "Change a vendor order"] },
    guard: guard(true, true, [GUARD_RULES.money]),
    doNothing: `Cash dips about ${usd(short)} under the floor midweek.`,
    effects: [{ label: "Weekly cash, with tonight's pace", from: usd(cash.withEstimates), to: usd(cash.withEstimates + deferrable.amount), basis: "estimated" }],
    evidence: evidence(t.sales, "Sales since open", t.sales ? `${usd(t.sales.value.soFar)} against ${usd(t.sales.value.planSoFar)}` : "—"),
    confidence: { level: "medium", reasons: ["Built on tonight's pace, which can still move."] },
    urgency: { by: null, label: "By Thursday" },
    remedies: [],
    explain: {
      owner: `Cash could dip under your floor this week. Push ${deferrable.label} to ${deferrable.to}.`,
      gm: "Nothing for the floor.",
      engineering: [`with_estimates = ${usd(cash.withEstimates)} < floor ${usd(cash.floor)} → suggest deferral of ${usd(deferrable.amount)}`],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Specialists                                                         */
/* ------------------------------------------------------------------ */

function observe(t: TwinCore, s: Scenario): Observation[] {
  const out: Observation[] = [];
  const add = (specialist: Observation["specialist"], text: string, refs: string[], counted = true) => out.push({ specialist, text, refs, counted });
  const d = t.demand;
  if (d.booked) add("demand", `${d.booked.value} covers booked${d.vsPlanPct !== null ? `, ${signedPct(d.vsPlanPct)} against plan` : ""}.`, [d.booked.eventId]);
  if (d.disputed) add("demand", `Host stand says ${d.disputed.value}. Counts disagree.`, [d.disputed.eventId]);
  if (d.peakCovers !== null) add("demand", `About ${Math.round(d.peakCovers)} covers an hour at the 7 PM peak.`, d.booked ? [d.booked.eventId] : []);
  if (d.nearbyEvent) add("demand", `${d.nearbyEvent.value.name} ends ${clock(d.nearbyEvent.value.endsAt)}. Listed, not counted.`, [d.nearbyEvent.eventId], false);

  const st = t.staffing;
  if (st.calledOut.length) add("labor", `${st.calledOut.map((c) => c.name).join(", ")} called out. ${st.servers} servers on the floor.`, []);
  if (st.peakLoad !== null) add("labor", `Peak load ${one(st.peakLoad)} covers per server against a ceiling of ${st.ceiling}.`, []);
  if (t.labor.pct !== null) add("labor", `Labor projects to ${pct(t.labor.pct)} against ${t.labor.goalPct}%.`, t.sales ? [t.sales.eventId] : []);

  for (const i of t.inventory) {
    const refs = [i.line?.eventId, i.backup?.eventId].filter((x): x is string => Boolean(x));
    if (i.status === "needs_backup_count") add("supply", `${i.name}: ${i.line?.value} on the line, ${i.forecast} forecast, backup not counted.`, refs);
    else if (i.status === "short") add("supply", `${i.name}: short ${i.exposure} tonight even with backup.`, refs);
    else if (i.status === "surplus") add("supply", `${i.name}: ${i.line?.value} on hand for ${i.forecast} forecast. Surplus.`, refs);
    else if (i.status === "ok") add("supply", `${i.name}: covered.`, refs, false);
  }
  for (const del of t.deliveries.filter((x) => x.short > 0)) add("supply", `${del.vendor} short ${del.short} of ${del.ordered}.`, [del.eventId]);

  for (const inv of t.invoices) {
    add("finance", inv.verdict === "in_line" ? `${inv.vendor} ${inv.number} in line with contract.` : `${inv.vendor} ${inv.number}: ${signedUsd(inv.total - inv.contractTotal)}, ${inv.verdict === "price" ? "price, not volume" : inv.verdict}.`, [inv.eventId], inv.verdict !== "in_line");
  }

  for (const st2 of t.ledger.stale) add("risk", `${SOURCES[st2.source].label} is ${st2.ageMin} minutes old. Conclusions that need it are withdrawn.`, []);
  for (const c of t.ledger.conflicts) add("risk", `${c.claim}: ${c.a.value} vs ${c.b.value}.${c.resolvedBy ? ` Settled by the ${c.resolvedBy}.` : " Unresolved."}`, [c.a.eventId, c.b.eventId]);
  for (const dup of t.ledger.duplicates) add("risk", `Duplicate ignored: ${dup.reason}`, [dup.ignored], false);
  for (const m of t.ledger.missing) add("risk", `Missing: ${m.claim}. ${m.why}`, []);

  for (const m of relevantPatterns(s.id)) {
    const label = m.status === "pattern" ? `Pattern (${m.supporting.length} nights)` : m.status === "needs_revalidation" ? "May no longer hold" : "Candidate";
    add("memory", `${label}: ${m.statement}`, [m.id], m.status === "pattern");
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export function plan({ twin, scenario, human, requests }: PlanInput): Plan {
  const surge = relevantPatterns(scenario.id).find((m) => m.id === "mem_surge_callout" && m.status === "pattern");
  const backing = surge ? { held: surge.supporting.length, nights: surge.supporting.length + surge.counter.length } : null;

  const drafted: Decision[] = [
    laborDecision(twin, scenario, backing),
    ...twin.inventory.map((i) => inventoryDecision(twin, scenario, i, requests)),
    purchasingDecision(twin, scenario),
    ...supplyDecisions(twin, scenario),
    ...invoiceDecisions(twin),
    eventDecision(twin),
  ].filter((d): d is Decision => d !== null);

  let decisions = drafted.map((d) => withHuman(d, human[d.key]));
  let cash = cashOf(twin, scenario, decisions);
  const cashD = cashDecision(twin, scenario, cash);
  if (cashD) {
    decisions = [...decisions, withHuman(cashD, human.cash)];
    const deferrable = scenario.plan.deferrable;
    if (deferrable) {
      const status = decisions.find((d) => d.key === "cash")?.status === "approved" ? "approved" : "proposed";
      cash = { ...cash, lines: [...cash.lines, { label: `${deferrable.label} moved to ${deferrable.to}`, amount: deferrable.amount, status, decision: "cash" }] };
      // An approved deferral moves both projections, so the pace estimate can't still show the old shortfall.
      if (status === "approved") cash = { ...cash, projected: cash.projected + deferrable.amount, withEstimates: cash.withEstimates + deferrable.amount };
      cash = { ...cash, proposedDelta: cash.proposedDelta + deferrable.amount };
    }
  }

  return { twin: { ...twin, cash }, observations: observe(twin, scenario), decisions };
}

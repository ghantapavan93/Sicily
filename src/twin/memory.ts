import type { DecisionKey, HumanAct, Outcome, ScenarioId, TeachReason } from "./types";

/*
 * LEARN. Decision memory is computed from records: past nights, what was
 * decided, what happened. It is never a guess about the owner's personality.
 * A memory needs MIN_EVIDENCE supporting nights to become a pattern, and
 * recent nights that contradict it put it back under review.
 */

export const MIN_EVIDENCE = 3;
/** This many recent counterexamples and a pattern is no longer trusted. */
export const CONTRADICTION_LIMIT = 3;

export interface MemoryRecord {
  date: string;
  note: string;
  tonight?: boolean;
}

export type MemoryStatus = "candidate" | "pattern" | "needs_revalidation";

export interface Memory {
  id: string;
  statement: string;
  /** What Savy does differently because of it. */
  usage: string;
  scenarios: ScenarioId[];
  origin: "outcomes" | "operator" | "disagreement";
  createdBy: "savy" | "owner";
  supporting: MemoryRecord[];
  counter: MemoryRecord[];
  lastValidated: string;
  status: MemoryStatus;
  updatedTonight: boolean;
}

type Seed = Omit<Memory, "status" | "updatedTonight">;

/** Synthetic history. Every record is a past night at this restaurant, invented for the prototype. */
const SEED: Seed[] = [
  {
    id: "mem_surge_callout",
    statement: "On a surge night with a server call-out, one added server has held the floor.",
    usage: "Savy recommends the on-call server early instead of waiting for tickets to run long.",
    scenarios: ["friday_rush"],
    origin: "outcomes",
    createdBy: "savy",
    supporting: [
      { date: "Fri Aug 28", note: "158 covers, a call-out, one added. Peak 13.8 per server. Tickets held." },
      { date: "Fri Sep 4", note: "171 covers, a call-out, one added. Peak 14.5. Tickets held." },
      { date: "Sat Sep 12", note: "166 covers, a call-out, one added. Peak 14.0. Tickets held." },
      { date: "Fri Sep 18", note: "149 covers, a call-out, one added. Peak 13.2. Tickets held." },
      { date: "Fri Sep 25", note: "162 covers, a call-out, one added. Peak 14.1. Tickets held." },
    ],
    counter: [],
    lastValidated: "Fri Sep 25",
  },
  {
    id: "mem_backup_first",
    statement: "When the line looks short, the walk-in usually covers it. Count before ordering.",
    usage: "Savy asks for a backup count before it adds anything to an order.",
    scenarios: ["friday_rush", "supplier_problem"],
    origin: "outcomes",
    createdBy: "savy",
    supporting: [
      { date: "Fri Sep 4", note: "Burrata line 28, forecast 33. Walk-in had 6. Nothing ordered." },
      { date: "Thu Sep 17", note: "Branzino line 14, forecast 18. Walk-in had 5." },
      { date: "Sat Sep 26", note: "Burrata line 30, forecast 34. Walk-in had 8." },
    ],
    counter: [{ date: "Fri Sep 11", note: "Burrata line 25, forecast 31. Walk-in was empty. Sold out at 9:10 PM." }],
    lastValidated: "Sat Sep 26",
  },
  {
    id: "mem_valley_summer",
    statement: "Greenline Produce runs 3 to 5% over contract in summer and settles back in the fall.",
    usage: "Savy treats small Greenline Produce overages as seasonal and flags only larger ones.",
    scenarios: ["friday_rush", "slow_night"],
    origin: "outcomes",
    createdBy: "savy",
    supporting: [
      { date: "Fri Jun 12", note: "+4% over contract. Back in line by July." },
      { date: "Fri Jul 10", note: "+3% over contract." },
      { date: "Fri Aug 7", note: "+5% over contract." },
      { date: "Fri Aug 21", note: "+4% over contract." },
    ],
    counter: [
      { date: "Fri Sep 11", note: "+9% over contract, in the fall." },
      { date: "Fri Sep 18", note: "+11% over contract." },
      { date: "Fri Sep 25", note: "+10% over contract." },
    ],
    lastValidated: "Fri Aug 21",
  },
  {
    id: "mem_rain_tuesday",
    statement: "Rain on a Tuesday cancels about a third of bookings, and walk-ins don't make it up.",
    usage: "Savy offers an early out sooner on a wet Tuesday instead of waiting for walk-ins.",
    scenarios: ["slow_night"],
    origin: "outcomes",
    createdBy: "savy",
    supporting: [
      { date: "Tue Aug 11", note: "88 booked, 59 came. 4 walk-ins." },
      { date: "Tue Aug 25", note: "90 booked, 63 came. 6 walk-ins." },
      { date: "Tue Sep 8", note: "94 booked, 60 came. 5 walk-ins." },
      { date: "Tue Sep 22", note: "86 booked, 58 came. 3 walk-ins." },
    ],
    counter: [],
    lastValidated: "Tue Sep 22",
  },
  {
    id: "mem_caseificio_short",
    statement: "Caseificio Rossi short-ships about one week in four.",
    usage: "Savy checks their deliveries line by line and drafts the credit request the same day.",
    scenarios: ["supplier_problem"],
    origin: "outcomes",
    createdBy: "savy",
    supporting: [
      { date: "Thu Aug 13", note: "Short 4 stracciatella." },
      { date: "Thu Sep 3", note: "Short 6 burrata." },
      { date: "Thu Sep 24", note: "Short 3 burrata." },
    ],
    counter: [],
    lastValidated: "Thu Sep 24",
  },
  {
    id: "mem_private_event",
    statement: "Private events want about 20% more burrata than their cover count suggests.",
    usage: "Savy raises the burrata forecast for private events, and says it did.",
    scenarios: [],
    origin: "operator",
    createdBy: "owner",
    supporting: [
      { date: "Sat Aug 22", note: "Owner: \"the rehearsal dinner ate all the burrata\". 30 covers, 9 extra portions." },
      { date: "Sat Sep 19", note: "40 covers, 8 extra portions." },
    ],
    counter: [],
    lastValidated: "Sat Sep 19",
  },
];

export function statusOf(m: Pick<Memory, "supporting" | "counter">): MemoryStatus {
  if (m.counter.length >= CONTRADICTION_LIMIT) return "needs_revalidation";
  if (m.supporting.length >= MIN_EVIDENCE && m.counter.length * 3 < m.supporting.length) return "pattern";
  return "candidate";
}

const REJECT_MEMORY: Record<TeachReason, { statement: string; usage: string }> = {
  floor_can_cover: {
    statement: "When the manager says the floor can cover a section, an added server isn't needed.",
    usage: "Savy asks the manager about floor coverage before recommending an added server.",
  },
  not_worth_cost: {
    statement: "On a surge night the owner would rather run tight than add a shift.",
    usage: "Savy shows the cost of running tight next to the cost of the shift, and leads with the first.",
  },
  know_something: {
    statement: "The owner sometimes knows about tonight before the systems do.",
    usage: "Savy asks what the owner knows before it recommends on a night like this.",
  },
  too_late: {
    statement: "A staffing change after 6 PM rarely lands in time.",
    usage: "Savy brings staffing decisions forward to the early afternoon.",
  },
  manager_overruled: {
    statement: "When the manager overrules an added server, the floor has sometimes held anyway.",
    usage: "Savy compares outcomes when the manager disagrees, before recommending again.",
  },
};

export interface LearnInput {
  scenario: ScenarioId;
  /** Present once the night has closed and been written to memory. */
  outcome: Outcome | null;
  remembered: boolean;
  human: Partial<Record<DecisionKey, HumanAct>>;
  /** Decisions the owner asked Savy to remember, with the reason given. */
  taught: { key: DecisionKey; reason: TeachReason }[];
  /** Items whose backup the manager counted tonight. */
  counted: { item: string; covered: boolean }[];
  invoiceOverPct: number | null;
}

/**
 * All memories as of now: the seed, plus what tonight added once it is
 * remembered, plus anything the owner chose to teach. Recomputed from the
 * records every time; nothing here is stored.
 */
export function memoriesOf(input: LearnInput): Memory[] {
  const out: Memory[] = SEED.map((s) => ({ ...s, supporting: [...s.supporting], counter: [...s.counter], status: statusOf(s), updatedTonight: false }));
  const find = (id: string) => out.find((m) => m.id === id);
  const tonight = (note: string): MemoryRecord => ({ date: "Tonight", note, tonight: true });
  const touch = (m: Memory | undefined, record: MemoryRecord, supports: boolean) => {
    if (!m) return;
    (supports ? m.supporting : m.counter).push(record);
    if (supports) m.lastValidated = "Tonight";
    m.updatedTonight = true;
  };

  if (input.remembered && input.outcome) {
    const run = input.outcome.actual;
    const staffing = input.human.staffing;
    if (input.scenario === "friday_rush") {
      const added = run.actions.some((a) => a.startsWith("Added"));
      touch(
        find("mem_surge_callout"),
        tonight(
          added
            ? `${run.totals.covers} covers, a call-out, one added. Peak ${run.totals.peakLoad.toFixed(1)} per server. Tickets ${run.totals.worstTicket} min at worst.`
            : `${run.totals.covers} covers, a call-out, none added${staffing?.kind === "rejected" ? " (the plan was overruled)" : ""}. Peak ${run.totals.peakLoad.toFixed(1)}. Tickets reached ${run.totals.worstTicket} min.`,
        ),
        true,
      );
    }
    if (input.scenario === "slow_night") {
      touch(find("mem_rain_tuesday"), tonight(`${run.totals.covers} covers after cancellations. Walk-ins didn't make it up.`), true);
    }
    for (const c of input.counted) {
      touch(find("mem_backup_first"), tonight(`${c.item}: the walk-in was counted before ordering. ${c.covered ? "It covered the gap." : "It wasn't enough."}`), c.covered);
    }
    if (input.invoiceOverPct !== null && input.invoiceOverPct > 5 && (input.scenario === "friday_rush" || input.scenario === "slow_night")) {
      touch(find("mem_valley_summer"), tonight(`+${Math.round(input.invoiceOverPct)}% over contract, in the fall.`), false);
    }
  }

  for (const t of input.taught) {
    const spec = REJECT_MEMORY[t.reason];
    out.push({
      id: `mem_taught_${t.key.replace(/[^a-z]/g, "_")}`,
      statement: spec.statement,
      usage: spec.usage,
      scenarios: [input.scenario],
      origin: t.reason === "manager_overruled" ? "disagreement" : "operator",
      createdBy: "owner",
      supporting: [tonight("Taught by the owner after a rejected recommendation.")],
      counter: [],
      lastValidated: "Tonight",
      status: "candidate",
      updatedTonight: true,
    });
  }

  for (const m of out) m.status = statusOf(m);
  return out;
}

/** Patterns that bear on this night, for the memory specialist. */
export const relevantPatterns = (scenario: ScenarioId) =>
  SEED.filter((s) => s.scenarios.includes(scenario)).map((s) => ({ ...s, status: statusOf(s) }));

/* ------------------------------------------------------------------ */
/* Operating DNA: what makes this restaurant itself                     */
/* ------------------------------------------------------------------ */

export interface DnaTrait {
  id: string;
  label: string;
  value: string;
  detail: string;
  basis: string;
}

/** A structured fingerprint from sample history. Every value is synthetic and labelled so. */
export const OPERATING_DNA: { group: string; traits: DnaTrait[] }[] = [
  {
    group: "Demand",
    traits: [
      { id: "fri_shape", label: "Friday shape", value: "35% of covers between 7 and 8 PM", detail: "The second turn starts at 8:30 and runs about 40% of the first.", basis: "30 Fridays" },
      { id: "walkins", label: "Walk-ins", value: "About 14 in the Friday peak hour", detail: "Twice that when an event ends within half a mile.", basis: "30 Fridays" },
      { id: "rain", label: "Weather", value: "Rain cancels about a third on weekdays", detail: "Weekend bookings barely move.", basis: "12 wet nights" },
    ],
  },
  {
    group: "How this owner runs labor",
    traits: [
      { id: "ceiling", label: "Floor ceiling", value: "16 covers per server, peak hour", detail: "Set by the owner. Tickets stretch past 15 minutes above it.", basis: "Owner set" },
      { id: "goal", label: "Labor goal", value: "30% or less", detail: "Measured weekly, not nightly. One heavy night is allowed.", basis: "Owner set" },
      { id: "oncall", label: "On-call", value: "Accepted 9 of 11 times", detail: "Median reply in 7 minutes.", basis: "11 requests" },
    ],
  },
  {
    group: "Vendors",
    traits: [
      { id: "valley", label: "Greenline Produce", value: "92% on time · 96% filled", detail: "Prices drifting up since September.", basis: "38 deliveries" },
      { id: "caseificio", label: "Caseificio Rossi", value: "98% on time · 88% filled", detail: "Short one week in four.", basis: "16 deliveries" },
    ],
  },
  {
    group: "Where the systems fail",
    traits: [
      { id: "pos_gaps", label: "POS sync gaps", value: "3 in September", detail: "Each under an hour. Two on Fridays between 4 and 6 PM.", basis: "Sync log" },
      { id: "res_mismatch", label: "Book vs host stand", value: "2 disagreements this month", detail: "Both from walk-in parties entered twice.", basis: "Reservation log" },
      { id: "dup_mail", label: "Duplicate supplier mail", value: "1 in 40 invoices", detail: "Always the same vendor, always within 5 minutes.", basis: "Supplier mail" },
    ],
  },
  {
    group: "How the floor answers",
    traits: [
      { id: "count_reply", label: "Count requests", value: "Answered in 6 minutes, median", detail: "11 of 12 within 15 minutes.", basis: "12 requests" },
      { id: "overrules", label: "Manager overrules", value: "2 of 19 staffing recommendations", detail: "Both on nights the host covered a section.", basis: "19 decisions" },
    ],
  },
];

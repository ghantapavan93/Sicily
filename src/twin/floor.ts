import type { Minutes } from "@/domain/clock";
import { HOUSE } from "@/domain/venue";
import type { Choices } from "./consequence";
import { ADDED_SHIFT, EARLY_OUT_AT } from "./twin";
import type { NightPoint, Shift, Twin } from "./types";
import { byText, lastServerIn } from "./sort";

/*
 * The floor. Sicily's dining room as sections and tables, and who is serving
 * which section at a given moment. Section loads come from the same night
 * simulation as everything else; the floor only shows where the load lands.
 * A section with no server is split between its neighbours, which is why one
 * call-out can put one server far over the ceiling while the average looks
 * merely high.
 */

export interface SectionSpec {
  id: number;
  name: string;
  seats: number;
  /** Who picks up this section if its server is missing. */
  neighbours: number[];
}

export const SECTIONS: SectionSpec[] = [
  { id: 1, name: "Window", seats: 16, neighbours: [2] },
  { id: 2, name: "Main left", seats: 16, neighbours: [1, 3] },
  { id: 3, name: "Main right", seats: 16, neighbours: [2, 4] },
  { id: 4, name: "Patio", seats: 16, neighbours: [3, 5] },
  { id: 5, name: "Bar", seats: 16, neighbours: [4] },
];

export const TOTAL_SEATS = SECTIONS.reduce((n, s) => n + s.seats, 0);

export interface SectionState {
  id: number;
  name: string;
  seats: number;
  /** The section's own server, or null if nobody is assigned to it right now. */
  server: string | null;
  /** Neighbours covering it when it has no server. */
  coveredBy: string[];
  /** Share of seats occupied in this half hour, 0 to 1. */
  occupancy: number;
}

export interface ServerLoad {
  name: string;
  sections: number[];
  /** Covers per hour this server is carrying. */
  load: number;
  over: boolean;
  added: boolean;
}

export interface FloorState {
  at: Minutes;
  sections: SectionState[];
  servers: ServerLoad[];
  /** Covers per hour across the room. */
  hourly: number;
  /** Walk-ins who left in this half hour, and in the night so far. */
  leftNow: number;
  left: number;
}

/** Which server owns which section: the schedule's order, one section each, the on-call takes whatever is empty. */
function assignments(t: Twin, choices: Choices, at: Minutes): { section: number; name: string; added: boolean }[] {
  const scheduled: Shift[] = t.staffing.scheduled;
  const calledOut = new Set(t.staffing.calledOut.map((s) => s.id));
  const working = scheduled.filter((s) => !calledOut.has(s.id));
  const lastIn = lastServerIn(working);
  const out: { section: number; name: string; added: boolean }[] = [];
  scheduled.forEach((s, i) => {
    const section = SECTIONS[i % SECTIONS.length]!.id;
    if (calledOut.has(s.id)) return;
    if (at < s.start || at >= s.end) return;
    if (choices.earlyOut && lastIn?.id === s.id && at >= EARLY_OUT_AT) return;
    out.push({ section, name: s.name, added: false });
  });
  // The simulation never runs a slot with nobody on the floor; neither does the floor. The last to leave closes.
  if (out.length === 0) {
    const closer = [...working].sort((a, b) => b.end - a.end || byText(a.name, b.name))[0];
    if (closer) out.push({ section: SECTIONS[scheduled.indexOf(closer) % SECTIONS.length]!.id, name: closer.name, added: false });
  }
  const onCall = t.staffing.onCall;
  if (choices.addServer && onCall && at >= ADDED_SHIFT.start && at < ADDED_SHIFT.end) {
    const empty = SECTIONS.find((sec) => !out.some((a) => a.section === sec.id));
    if (empty) out.push({ section: empty.id, name: onCall.name, added: true });
  }
  return out;
}

export function floorAt(t: Twin, choices: Choices, point: NightPoint, walkAwaysSoFar = 0): FloorState {
  const assigned = assignments(t, choices, point.at);
  // The same demand the run used, so a section's load matches the run's load per server.
  const hourly = point.hourly;
  const byName = new Map<string, ServerLoad>();
  for (const a of assigned) byName.set(a.name, { name: a.name, sections: [a.section], load: 0, over: false, added: a.added });

  // An empty section's seats go to the nearest covered neighbours, split evenly.
  const shareOf = new Map<string, number>();
  const sections: SectionState[] = SECTIONS.map((sec) => {
    const own = assigned.find((a) => a.section === sec.id);
    let coveredBy: string[] = [];
    if (own) shareOf.set(own.name, (shareOf.get(own.name) ?? 0) + sec.seats);
    else {
      coveredBy = sec.neighbours.map((n) => assigned.find((a) => a.section === n)?.name).filter((x): x is string => Boolean(x));
      if (coveredBy.length === 0 && assigned.length) coveredBy = [assigned[0]!.name];
      for (const name of coveredBy) {
        shareOf.set(name, (shareOf.get(name) ?? 0) + sec.seats / coveredBy.length);
        byName.get(name)?.sections.push(sec.id);
      }
    }
    return { id: sec.id, name: sec.name, seats: sec.seats, server: own?.name ?? null, coveredBy, occupancy: Math.min(1, (hourly / 2) * 1.6 / TOTAL_SEATS) };
  });

  for (const s of byName.values()) {
    s.load = Number(((hourly * (shareOf.get(s.name) ?? 0)) / TOTAL_SEATS).toFixed(1));
    s.over = s.load > HOUSE.loadCeiling;
  }
  return { at: point.at, sections, servers: [...byName.values()], hourly, leftNow: point.lost, left: walkAwaysSoFar };
}

/** The floor for a whole simulated night, one frame per half hour. */
export function floorsOf(t: Twin, choices: Choices, points: NightPoint[]): FloorState[] {
  let left = 0;
  return points.map((p) => {
    left += p.lost;
    return floorAt(t, choices, p, left);
  });
}

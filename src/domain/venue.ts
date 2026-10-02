/**
 * One place for everything that names the restaurant and its standing goals.
 * All figures in this prototype are synthetic; changing a name here changes
 * it everywhere.
 */
export const VENUE = {
  name: "Sicily",
  owner: "Joseph",
} as const;

/** Owner-set goals and house standards. The engine never invents these. */
export const HOUSE = {
  laborGoalPct: 30,
  /** Share of booked covers that land in the 7–8 PM hour, from sample history. */
  peakHourShare: 0.35,
  /** Walk-ins usually seated in the peak hour on a Friday, from sample history. */
  peakWalkIns: 14,
  /** Peak covers per server at which the floor has held on comparable nights. */
  loadCeiling: 16,
  /** Below this many peak covers per server, a server is standing more than serving. */
  loadFloor: 9,
  /** Sample server wage. Wages only, before taxes and benefits. */
  serverRate: 13,
  /** Ticket time when the floor is inside its ceiling, from sample history. */
  baseTicketMinutes: 12,
} as const;

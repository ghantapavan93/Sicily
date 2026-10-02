import type { SourceId } from "./types";

export interface SourceSpec {
  label: string;
  system: string;
  /** A reading older than this is stale. */
  staleAfterMin: number;
}

/**
 * The systems the twin reads, named the way OPSAVOR names them in public:
 * POS, time and payroll, supplier email, the bank and accounting. No vendor
 * is implied, and nothing here is connected to anything real.
 */
export const SOURCES: Record<SourceId, SourceSpec> = {
  pos: { label: "POS", system: "Point of sale", staleAfterMin: 15 },
  reservations: { label: "Reservations", system: "Reservation book", staleAfterMin: 45 },
  schedule: { label: "Schedule", system: "Time and payroll", staleAfterMin: 2880 },
  staff: { label: "Staff app", system: "Messages from the team", staleAfterMin: 1440 },
  inventory: { label: "Inventory", system: "Counts and receiving", staleAfterMin: 360 },
  suppliers: { label: "Supplier email", system: "Invoices and deliveries", staleAfterMin: 1440 },
  bank: { label: "Bank and accounting", system: "Bank feed and books", staleAfterMin: 1440 },
  events: { label: "Local events", system: "Public listings", staleAfterMin: 1440 },
};

export const SOURCE_ORDER: SourceId[] = ["pos", "reservations", "schedule", "staff", "inventory", "suppliers", "bank", "events"];

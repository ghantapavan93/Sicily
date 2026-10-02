import clsx from "clsx";
import {
  CalendarDays,
  ClipboardList,
  Cpu,
  Landmark,
  MapPin,
  MessageSquare,
  Package,
  Receipt,
  Sparkles,
  Truck,
  User,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { Basis, ConfidenceLevel, Freshness } from "@/domain/types";
import type { Actor, SourceId } from "@/twin/types";

export type Origin = SourceId | Actor;
import { Chip } from "./primitives";

/* One map from state to tone. Every badge in the product reads from it. */

const BASIS: Record<Basis, { label: string; tone: "verified" | "planned" | "neutral" | "unknown"; dashed?: boolean; hint: string }> = {
  actual: { label: "Actual", tone: "verified", hint: "Recorded by a system. It happened." },
  scheduled: { label: "Scheduled", tone: "planned", hint: "Planned by a person. It has not happened yet." },
  expected: { label: "Expected", tone: "planned", dashed: true, hint: "Booked or listed. It may change." },
  estimated: { label: "Estimated", tone: "neutral", dashed: true, hint: "Computed from sample history. A range, not a fact." },
  owner_set: { label: "Owner set", tone: "neutral", hint: "A goal the owner chose. Savy measures against it." },
  reported: { label: "Reported", tone: "neutral", hint: "A person's say-so, kept apart from system records." },
  unknown: { label: "Unknown", tone: "unknown", hint: "Not known. Never counted as zero or as fine." },
};

export function BasisBadge({ basis }: { basis: Basis }) {
  const b = BASIS[basis];
  return (
    <Chip tone={b.tone} dashed={b.dashed} title={b.hint}>
      {b.label}
    </Chip>
  );
}

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  if (freshness === "fresh") return null;
  return freshness === "stale" ? (
    <Chip tone="brass" title="Older than this source's freshness window.">
      Stale
    </Chip>
  ) : (
    <Chip tone="unknown" title="No usable reading from this source.">
      No reading
    </Chip>
  );
}

const CONFIDENCE: Record<ConfidenceLevel, { label: string; filled: number; bar: string; text: string }> = {
  none: { label: "Not yet", filled: 0, bar: "bg-unknown", text: "text-unknown" },
  low: { label: "Low", filled: 1, bar: "bg-conflict", text: "text-conflict" },
  medium: { label: "Medium", filled: 2, bar: "bg-brass", text: "text-brass-ink" },
  high: { label: "High", filled: 3, bar: "bg-verified", text: "text-verified" },
};

/** A level with reasons beside it. Never a percentage. */
export function ConfidenceMeter({ level }: { level: ConfidenceLevel }) {
  const c = CONFIDENCE[level];
  return (
    <span className="inline-flex items-center gap-2.5" aria-label={`Confidence: ${c.label}`}>
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={clsx("h-1.5 w-6 rounded-full transition-colors duration-300", i < c.filled ? c.bar : "bg-line")}
          />
        ))}
      </span>
      <span className={clsx("text-sm font-semibold", c.text)}>{c.label}</span>
    </span>
  );
}

const ORIGIN: Record<Origin, { icon: LucideIcon; label: string }> = {
  pos: { icon: Receipt, label: "POS" },
  reservations: { icon: CalendarDays, label: "Reservations" },
  schedule: { icon: ClipboardList, label: "Schedule" },
  staff: { icon: MessageSquare, label: "Staff app" },
  inventory: { icon: Package, label: "Inventory" },
  suppliers: { icon: Truck, label: "Supplier email" },
  bank: { icon: Landmark, label: "Bank and accounting" },
  events: { icon: MapPin, label: "Local events" },
  owner: { icon: User, label: "Owner" },
  manager: { icon: UserCheck, label: "Manager" },
  savy: { icon: Sparkles, label: "Savy" },
  vendor: { icon: Truck, label: "Vendor" },
  system: { icon: Cpu, label: "System" },
};

export const originLabel = (origin: Origin) => ORIGIN[origin].label;

export function OriginIcon({ origin, className }: { origin: Origin; className?: string }) {
  const Icon = ORIGIN[origin].icon;
  return <Icon aria-hidden className={clsx("size-4 shrink-0", className)} strokeWidth={1.75} />;
}

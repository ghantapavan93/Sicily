"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { Send } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatClock } from "@/domain/clock";
import { one, pct, signedUsd, unitUsd, usd } from "@/twin/format";
import type { CashLine, InventoryLine } from "@/twin/types";
import { useTwin } from "../experience/TwinContext";
import { BasisBadge } from "../ui/badges";
import { Button, Chip, Eyebrow, Panel } from "../ui/primitives";

type SurfaceId = "staffing" | "inventory" | "purchasing" | "invoices" | "cash";
const TABS: { id: SurfaceId; label: string }[] = [
  { id: "staffing", label: "Staff" },
  { id: "inventory", label: "Stock" },
  { id: "purchasing", label: "Orders" },
  { id: "invoices", label: "Invoices" },
  { id: "cash", label: "Cash" },
];

/** A figure that flashes once when it changes, so a ripple through the twin is visible. */
function Flash({ value, children, className }: { value: string | number | null; children?: ReactNode; className?: string }) {
  return (
    <span key={String(value)} className={clsx("changed rounded px-1 -mx-1", className)}>
      {children ?? value ?? "—"}
    </span>
  );
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-sm text-ink-mid">
        {label}
        {hint && <span className="block text-[0.6875rem] text-ink-lo">{hint}</span>}
      </dt>
      <dd className="text-right font-mono text-sm text-ink-hi">{children}</dd>
    </div>
  );
}

function Staffing() {
  const { ev } = useTwin();
  const t = ev.twin;
  const st = t.staffing;
  const scale = 24;
  const load = st.peakLoad;
  const atPlan = t.demand.peakCovers !== null && st.servers > 0 ? t.demand.peakCovers / st.servers : null;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Eyebrow>Peak covers per server</Eyebrow>
        <span className="font-mono text-xs text-ink-lo">7 PM hour</span>
      </div>
      <div className="mt-3">
        <div className="relative h-3 rounded-full bg-ground-3">
          {atPlan !== null && load !== null && Math.abs(atPlan - load) > 0.05 && (
            <span className="absolute inset-y-0 left-0 rounded-full bg-ink-lo/25" style={{ width: `${Math.min(100, (atPlan / scale) * 100)}%` }} />
          )}
          {load !== null && (
            <motion.span
              className={clsx("absolute inset-y-0 left-0 rounded-full", load > st.ceiling ? "bg-brass" : "bg-verified")}
              animate={{ width: `${Math.min(100, (load / scale) * 100)}%` }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            />
          )}
          <span className="absolute -top-1 h-5 w-px bg-ink-hi/70" style={{ left: `${(st.ceiling / scale) * 100}%` }} />
          <span className="absolute -top-1 h-5 w-px bg-ink-lo/60" style={{ left: `${(st.floor / scale) * 100}%` }} />
        </div>
        <div className="relative mt-1.5 h-4 text-[0.625rem] text-ink-lo">
          <span className="absolute -translate-x-1/2" style={{ left: `${(st.floor / scale) * 100}%` }}>
            floor {st.floor}
          </span>
          <span className="absolute -translate-x-1/2" style={{ left: `${(st.ceiling / scale) * 100}%` }}>
            ceiling {st.ceiling}
          </span>
        </div>
        <p className="mt-2 font-display text-3xl font-light text-ink-hi">
          <Flash value={load === null ? null : one(load)} />
          <span className="ml-2 text-sm text-ink-lo">{load === null ? "cover count unsettled" : `with ${st.servers + st.added.length} servers`}</span>
        </p>
      </div>

      <ul className="mt-4 divide-y divide-line-soft border-y border-line-soft">
        {[...st.scheduled, ...st.added].map((s) => {
          const out = st.calledOut.some((c) => c.id === s.id);
          const added = st.added.some((a) => a.id === s.id);
          const cut = st.cut.find((c) => c.id === s.id);
          return (
            <li key={`${s.id}-${added}`} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className={clsx(out ? "text-ink-lo line-through" : "text-ink-hi")}>{s.name}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-ink-lo">
                  {formatClock(s.start)}–{formatClock(cut ? cut.start : s.end)}
                </span>
                {out ? <Chip tone="unknown">Called out</Chip> : added ? <Chip tone="brass">Added · draft</Chip> : cut ? <Chip tone="brass">Early out</Chip> : null}
              </span>
            </li>
          );
        })}
      </ul>

      <dl className="mt-2 divide-y divide-line-soft">
        <Row label="Wages tonight" hint="Scheduled, wages only">
          <Flash value={usd(t.labor.wages)} />
        </Row>
        <Row label="Sales, projected" hint={t.sales ? `POS ${t.sales.freshness}` : "No sales reading"}>
          <Flash value={t.labor.projectedSales === null ? "unknown" : usd(t.labor.projectedSales)} />
        </Row>
        <Row label="Labor" hint={`Goal ${t.labor.goalPct}% or less`}>
          <Flash value={t.labor.pct === null ? "unknown" : pct(t.labor.pct)} className={t.labor.pct !== null && t.labor.pct > t.labor.goalPct ? "text-brass-ink" : undefined} />
        </Row>
      </dl>
    </div>
  );
}

const ITEM_STATUS: Record<InventoryLine["status"], { label: string; tone: "verified" | "brass" | "unknown" | "conflict" | "neutral" }> = {
  ok: { label: "Covered", tone: "verified" },
  short: { label: "Short tonight", tone: "brass" },
  needs_backup_count: { label: "Backup not counted", tone: "unknown" },
  needs_count: { label: "No count", tone: "unknown" },
  discrepancy: { label: "Count doesn't add up", tone: "conflict" },
  surplus: { label: "Surplus", tone: "neutral" },
  blocked: { label: "Waits on covers", tone: "unknown" },
  not_due: { label: "Count not due", tone: "neutral" },
};

function Inventory() {
  const { ev, state } = useTwin();
  return (
    <ul className="space-y-3">
      {ev.twin.inventory.map((i) => {
        const s = ITEM_STATUS[i.status];
        const asked = state.requests.find((r) => r.item === i.item);
        return (
          <li key={i.item} className="rounded-xl border border-line bg-ground-2/50 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink-hi">{i.name}</span>
              <Chip tone={s.tone} dashed={s.tone === "unknown"}>
                {s.label}
              </Chip>
            </div>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                ["Line", i.line?.value ?? "—"],
                ["Backup", i.backup ? i.backup.value : "?"],
                ["Forecast", i.forecast ?? "—"],
                ["Short", i.exposure === null ? "—" : Math.max(0, i.exposure)],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-[0.625rem] uppercase tracking-[0.1em] text-ink-lo">{label}</dt>
                  <dd className={clsx("mt-1 font-mono text-lg", value === "?" ? "text-unknown" : "text-ink-hi")}>
                    <Flash value={value as string | number} />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-lo">
              {i.runOutAt ? `Runs out around ${formatClock(i.runOutAt)} at this pace. ` : ""}
              {i.backup === null && i.status !== "not_due" ? "Backup unknown. Unknown is not zero. " : ""}
              {asked ? (asked.answeredAt === null ? "Asked the manager. Waiting." : `Manager counted ${asked.value} at ${formatClock(asked.answeredAt)}.`) : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

const PO_STATUS = {
  none: { label: "Nothing to order", tone: "neutral" },
  draft: { label: "Draft · owner approval required", tone: "brass" },
  approved: { label: "Approved · not submitted", tone: "brass" },
  unknown: { label: "Submission status unknown", tone: "unknown" },
  confirmed: { label: "Confirmed by vendor", tone: "verified" },
} as const;

function Purchasing() {
  const { ev, state, dispatch, session } = useTwin();
  const po = ev.twin.purchasing;
  const s = PO_STATUS[po.status];
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Tomorrow&apos;s order</Eyebrow>
        <Chip tone={s.tone} dashed={s.tone === "unknown"}>
          {s.label}
        </Chip>
      </div>
      {po.lines.length === 0 ? (
        <p className="mt-3 text-sm text-ink-mid">The standing order covers tomorrow.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <tbody className="divide-y divide-line-soft">
            {po.lines.map((l) => (
              <tr key={l.item} title={l.why}>
                <td className="py-2 text-ink-hi">{l.name}</td>
                <td className="py-2 text-right font-mono text-ink-hi">
                  <Flash value={`${l.qty > 0 ? "+" : "−"}${Math.abs(l.qty)}`} />
                </td>
                <td className="py-2 text-right font-mono text-ink-lo">× {unitUsd(l.unitCost)}</td>
                <td className="py-2 text-right font-mono text-ink-hi">{usd(l.qty * l.unitCost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td colSpan={3} className="pt-2 text-ink-mid">
                Total
              </td>
              <td className="pt-2 text-right font-mono font-semibold text-ink-hi">
                <Flash value={`${po.total < 0 ? "−" : ""}${usd(po.total)}`} />
              </td>
            </tr>
          </tfoot>
        </table>
      )}
      <p className="mt-3 text-xs leading-relaxed text-ink-lo">{po.lines[0]?.why}</p>
      {state.po === "approved" && !state.submission && session.live && (
        <Button variant="primary" size="sm" className="mt-3" onClick={() => dispatch({ type: "SUBMIT_PO" })}>
          <Send aria-hidden className="size-3.5" />
          Submit to vendor
        </Button>
      )}
      {state.submission && (
        <ol className="mt-4 space-y-1.5 rounded-xl border border-line bg-ground-0 p-3 font-mono text-[0.6875rem] leading-relaxed">
          {state.submission.log.map((l, i) => (
            <motion.li key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={clsx(l.text.startsWith("Existing") ? "text-verified" : l.text.includes("unknown") ? "text-brass-ink" : "text-ink-mid")}>
              {formatClock(l.at)} · {l.text}
            </motion.li>
          ))}
          {state.submission.status === "unknown" && <li className="animate-pulse text-ink-lo">Reconciling with the vendor before anything is retried…</li>}
        </ol>
      )}
    </div>
  );
}

function Invoices() {
  const { ev } = useTwin();
  if (ev.twin.invoices.length === 0) return <p className="text-sm text-ink-mid">No invoices tonight.</p>;
  return (
    <ul className="space-y-4">
      {ev.twin.invoices.map((inv) => {
        const max = Math.max(1, Math.abs(inv.priceEffect), Math.abs(inv.volumeEffect));
        return (
          <li key={inv.key} className="rounded-xl border border-line bg-ground-2/50 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink-hi">{inv.vendor}</p>
                <p className="font-mono text-xs text-ink-lo">{inv.number}</p>
              </div>
              {inv.duplicatesSuppressed > 0 && <Chip tone="neutral">Duplicate ignored</Chip>}
            </div>
            <dl className="mt-3 divide-y divide-line-soft">
              <Row label="This invoice">{usd(inv.total)}</Row>
              <Row label="On contract">{usd(inv.contractTotal)}</Row>
              <Row label="Last four, average">{usd(inv.previousAvg)}</Row>
            </dl>
            <div className="mt-3 space-y-2">
              {[
                ["Price", inv.priceEffect],
                ["Volume", inv.volumeEffect],
              ].map(([label, n]) => (
                <div key={label as string} className="grid grid-cols-[4rem_1fr_4.5rem] items-center gap-2 text-xs">
                  <span className="text-ink-lo">{label}</span>
                  <span className="h-2 rounded-full bg-ground-3">
                    <span className="block h-2 rounded-full bg-brass/80" style={{ width: `${(Math.abs(n as number) / max) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono text-ink-hi">{signedUsd(n as number)}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-hi">
              {inv.verdict === "price"
                ? "This looks like a price change, not more volume."
                : inv.verdict === "in_line"
                  ? "In line with the contract."
                  : inv.verdict === "volume"
                    ? "This looks like more volume, not a price change."
                    : "Both prices and quantities moved."}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

const CASH_TONE: Record<CashLine["status"], { label: string; tone: "brass" | "verified" | "neutral" | "unknown" }> = {
  proposed: { label: "Proposed", tone: "brass" },
  approved: { label: "Approved", tone: "verified" },
  realized: { label: "On the books", tone: "neutral" },
  estimated: { label: "Estimate, not counted", tone: "unknown" },
};

function Cash() {
  const { ev } = useTwin();
  const c = ev.twin.cash;
  return (
    <div>
      <dl className="divide-y divide-line-soft">
        <Row label="Weekly cash before tonight">{usd(c.baseline)}</Row>
      </dl>
      <ul className="mt-1 space-y-2">
        {c.lines.map((l) => (
          <li key={l.label} className="flex items-start justify-between gap-3 rounded-lg bg-ground-2/50 px-3 py-2">
            <span className="min-w-0 text-sm text-ink-mid">
              {l.label}
              <span className="mt-1 block">
                <Chip tone={CASH_TONE[l.status].tone} dashed={l.status === "estimated"}>
                  {CASH_TONE[l.status].label}
                </Chip>
              </span>
            </span>
            <span className={clsx("whitespace-nowrap font-mono text-sm", l.status === "estimated" ? "text-ink-lo" : l.amount < 0 ? "text-ink-hi" : "text-verified")}>
              <Flash value={`${l.amount}-${l.status}`}>{signedUsd(l.amount)}</Flash>
            </span>
          </li>
        ))}
      </ul>
      <dl className="mt-2 divide-y divide-line-soft border-t border-line">
        <Row label="Projected weekly cash" hint={`Your floor is ${usd(c.floor)}`}>
          <Flash value={usd(c.projected)} className={c.projected < c.floor ? "text-brass-ink" : undefined} />
        </Row>
      </dl>
      <p className="mt-3 rounded-xl border border-brass/35 bg-brass/[0.05] px-3 py-2.5 text-sm leading-snug text-ink-hi">
        Tonight&apos;s proposed decisions change projected weekly cash by <span className="font-mono">{signedUsd(c.proposedDelta)}</span>.
      </p>
      <p className="mt-2 text-xs text-ink-lo">Estimates are shown and never added. Unknown is not zero.</p>
    </div>
  );
}

/** Five surfaces of one twin. Approve anything and watch it land in all of them. */
export function Surfaces() {
  const [tab, setTab] = useState<SurfaceId>("staffing");
  const { ev } = useTwin();
  const flagged: Record<SurfaceId, boolean> = {
    staffing: ev.decisions.some((d) => d.domain === "labor" && d.status !== "approved"),
    inventory: ev.twin.inventory.some((i) => i.status !== "ok" && i.status !== "not_due" && i.status !== "surplus"),
    purchasing: ev.twin.purchasing.status === "draft" || ev.twin.purchasing.status === "unknown",
    invoices: ev.twin.invoices.some((i) => i.verdict !== "in_line"),
    cash: ev.twin.cash.projected < ev.twin.cash.floor || ev.decisions.some((d) => d.key === "cash"),
  };

  return (
    <Panel className="overflow-hidden xl:sticky xl:top-20">
      <div role="tablist" aria-label="Operating surfaces" className="grid grid-cols-5 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "relative flex items-center justify-center gap-1 px-1 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] transition-colors",
              tab === t.id ? "text-ink-hi" : "text-ink-lo hover:text-ink-mid",
            )}
          >
            {t.label}
            {flagged[t.id] && <span aria-label="Needs attention" className="size-1.5 rounded-full bg-brass" />}
            {tab === t.id && <motion.span layoutId="surface-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brass" />}
          </button>
        ))}
      </div>
      <div className="p-5">
        {tab === "staffing" && <Staffing />}
        {tab === "inventory" && <Inventory />}
        {tab === "purchasing" && <Purchasing />}
        {tab === "invoices" && <Invoices />}
        {tab === "cash" && <Cash />}
      </div>
      <p className="border-t border-line px-5 py-3 text-[0.6875rem] text-ink-lo">
        Every figure is a projection of one restaurant twin. <BasisBadge basis="estimated" /> means computed from sample history.
      </p>
    </Panel>
  );
}

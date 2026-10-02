"use client";

import { Download } from "lucide-react";
import { formatClock } from "@/domain/clock";
import type { Receipt as ReceiptData } from "@/twin/types";
import { Button } from "../ui/primitives";

function download(r: ReceiptData) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${r.id.toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function Block({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="border-t border-dashed border-line px-5 py-3">
      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-ink-lo">{label}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((x) => (
          <li key={x} className="text-[0.8125rem] leading-snug text-ink-mid">
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The decision receipt: what was known, what wasn't, what Savy recommended,
 * what the person chose, what followed, and what happened. Accountability
 * for the owner, reconstructability for the engineer, and the unit memory
 * is built from.
 */
export function Receipt({ receipt }: { receipt: ReceiptData }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-[#f4ede1] text-[#1b1714] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.9)]">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[#7a6a55]">Decision receipt</p>
          <p className="mt-1 font-mono text-sm">
            {receipt.id} · {receipt.decisionId} v{receipt.version}
          </p>
        </div>
        <p className="font-mono text-sm">{formatClock(receipt.at)}</p>
      </div>
      <div className="mt-4 space-y-0 [&_.text-ink-mid]:text-[#3b3128] [&_.text-ink-lo]:text-[#7a6a55] [&_.border-line]:border-[#cdbfa9]">
        <div className="border-t border-dashed border-line px-5 py-3">
          <div className="grid grid-cols-[6.5rem_1fr] gap-y-1.5 text-[0.8125rem]">
            <span className="text-ink-lo">Recommended</span>
            <span>{receipt.recommended}</span>
            <span className="text-ink-lo">Chosen</span>
            <span className="font-semibold">{receipt.chosen}</span>
            <span className="text-ink-lo">By</span>
            <span>{receipt.approver}</span>
          </div>
        </div>
        <Block label="Known at the time" items={receipt.known} />
        <Block label="Not known" items={receipt.unknown} />
        <Block label="What followed" items={receipt.followed} />
        <Block label="What happened" items={[receipt.outcome ?? "Waiting for the night to close."]} />
      </div>
      <div className="flex justify-end border-t border-dashed border-[#cdbfa9] px-5 py-3">
        <Button variant="ghost" size="sm" className="!text-[#3b3128]" onClick={() => download(receipt)}>
          <Download aria-hidden className="size-3.5" />
          JSON
        </Button>
      </div>
    </article>
  );
}

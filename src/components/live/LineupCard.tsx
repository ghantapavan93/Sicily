"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Printer, X } from "lucide-react";
import { useMemo } from "react";
import { lineupOf } from "@/twin/briefings";
import { useTwin } from "../experience/TwinContext";
import { useLayer } from "../ui/layer";
import { Button, Eyebrow } from "../ui/primitives";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="border-t border-dashed border-[#cdbfa9] px-6 py-4">
      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[#7a6a55]">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((x) => (
          <li key={x} className="text-sm leading-snug">
            {x}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The pre-shift huddle, drafted by Savy for the manager to read out. Built
 * from what has actually been decided: if the added server isn't approved,
 * the patio is split, and the card says so.
 */
export function LineupCard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useTwin();
  const lineup = useMemo(() => (open ? lineupOf(state) : null), [open, state]);

  const layer = useLayer<HTMLElement>(open, onClose);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-ground-0/70 px-4 py-10 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.article
            ref={layer}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Pre-shift lineup"
            data-print
            initial={{ y: 16, rotate: -0.6 }}
            animate={{ y: 0, rotate: 0 }}
            exit={{ y: 12 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl overflow-hidden rounded-2xl bg-[#f4ede1] outline-none text-[#1b1714] shadow-[0_30px_80px_-30px_rgba(0,0,0,1)]"
          >
            {lineup ? (
              <>
                <header className="flex items-start justify-between gap-4 px-6 pt-6">
                  <div>
                    <p className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-[#7a6a55]">Drafted by Savy · read out by the manager</p>
                    <h2 className="mt-1 font-display text-3xl font-light">{lineup.title}</h2>
                    <p className="mt-1 text-sm text-[#3b3128]">{lineup.covers}</p>
                  </div>
                  <span className="font-mono text-sm">{lineup.at}</span>
                </header>
                <section className="mt-4 border-t border-dashed border-[#cdbfa9] px-6 py-4">
                  <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[#7a6a55]">Sections at the peak</p>
                  <table className="mt-2 w-full text-sm">
                    <tbody>
                      {lineup.sections.map((s) => (
                        <tr key={s.section} className="border-b border-[#e3d8c6] last:border-0">
                          <td className="py-1.5 pr-3 font-mono text-xs text-[#7a6a55]">{s.section}</td>
                          <td className={clsx("py-1.5 pr-3 font-semibold", s.over && "text-[#9a5b1e]")}>{s.who}</td>
                          <td className={clsx("py-1.5 text-right text-xs", s.over ? "text-[#9a5b1e]" : "text-[#3b3128]")}>{s.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <List title="Stock" items={lineup.stock} />
                <List title="Watch" items={lineup.watch} />
                <List title="Calls" items={lineup.calls} />
                <footer className="flex items-center justify-between gap-3 border-t border-dashed border-[#cdbfa9] px-6 py-3" data-noprint>
                  <span className="text-xs text-[#7a6a55]">Synthetic. Nothing here was sent.</span>
                  <span className="flex gap-2">
                    <Button variant="ghost" size="sm" className="!text-[#3b3128]" onClick={() => window.print()}>
                      <Printer aria-hidden className="size-3.5" />
                      Print
                    </Button>
                    <Button variant="ghost" size="sm" className="!text-[#3b3128]" onClick={onClose}>
                      <X aria-hidden className="size-3.5" />
                      Close
                    </Button>
                  </span>
                </footer>
              </>
            ) : (
              <div className="p-6">
                <Eyebrow>Lineup</Eyebrow>
                <p className="mt-2 text-sm">The lineup needs a settled cover count. Settle it first.</p>
              </div>
            )}
          </motion.article>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { formatClock } from "@/domain/clock";
import { VENUE } from "@/domain/venue";
import type { ManagerRequest } from "@/twin/types";
import { useTwin } from "../experience/TwinContext";

const LINGER_MS = 4500;

/**
 * When the evidence Savy needs is on a shelf, not in a system, it asks the
 * restaurant for one piece of reality. This is the manager's side of that:
 * the question arrives on the staff app, the manager answers, and the
 * answer flows back into the twin.
 */
export function ManagerPhone() {
  const { state, ev, session } = useTwin();
  const latest: ManagerRequest | undefined = state.requests.at(-1);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!latest || !session.live) {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (latest.answeredAt === null) return;
    const id = window.setTimeout(() => setVisible(false), LINGER_MS);
    return () => window.clearTimeout(id);
  }, [latest, session.live]);

  const name = latest ? ev.scenario.items[latest.item]?.name.toLowerCase() ?? latest.item : "";
  const answered = latest?.answeredAt !== null && latest?.answeredAt !== undefined;

  return (
    <AnimatePresence>
      {visible && latest && (
        <motion.div
          key={`${latest.item}-${latest.askedAt}`}
          initial={{ opacity: 0, y: 40, rotate: -2 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          exit={{ opacity: 0, y: 30 }}
          transition={{ type: "spring", stiffness: 220, damping: 24 }}
          className="fixed bottom-5 left-5 z-40 w-[17rem] origin-bottom-left rounded-[2.2rem] max-sm:bottom-3 max-sm:left-3 max-sm:scale-[0.78] border border-line bg-[#0a0807] p-2.5 shadow-[0_30px_80px_-30px_rgba(0,0,0,1)]"
          role="status"
          aria-label="The manager's phone"
        >
          <div className="rounded-[1.8rem] bg-ground-1 px-4 pb-5 pt-3">
            <div className="flex justify-between font-mono text-[0.625rem] text-ink-lo">
              <span>{formatClock(latest.askedAt)}</span>
              <span>Staff app · Manager</span>
            </div>
            <div className="mt-4 rounded-2xl bg-ground-3 p-3">
              <p className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-brass-ink">From {VENUE.owner}, via Savy</p>
              <p className="mt-1 text-sm leading-snug text-ink-hi">
                Can you count the {name} {latest.place === "backup" ? "in the walk-in" : "on the line"}? One number is enough.
              </p>
            </div>
            <div className="mt-3 flex justify-end">
              <AnimatePresence mode="wait">
                {answered ? (
                  <motion.div key="reply" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl rounded-br-md bg-verified/90 px-3.5 py-2 text-sm font-semibold text-ground-0">
                    {latest.value} {name}
                    <span className="ml-2 inline-flex items-center gap-1 text-[0.625rem] font-normal">
                      <Check aria-hidden className="size-3" /> {formatClock(latest.answeredAt!)}
                    </span>
                  </motion.div>
                ) : (
                  <motion.div key="typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="flex items-center gap-1 rounded-2xl bg-ground-3 px-3 py-2.5" aria-label="The manager is counting">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="typing-dot size-1.5 rounded-full bg-ink-mid" style={{ animationDelay: `${i * 0.16}s` }} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <p className="mt-3 text-center text-[0.625rem] text-ink-lo">{answered ? "Back in the twin. The decision updates itself." : "The manager is counting."}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

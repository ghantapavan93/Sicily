"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, X } from "lucide-react";
import { SPRING } from "@/lib/motion";
import { useTwin } from "../experience/TwinContext";
import { useLayer } from "../ui/layer";
import { MorphOrb } from "../ui/morph-orb";
import { SavyConversation } from "./SavyConversation";
import { useSavy } from "./SavyContext";

/**
 * Savy beside whatever the person is looking at. The same conversation as
 * the full Ask chapter, in a panel that slides over the right edge so a
 * question can be asked without leaving the decision.
 */
export function SavyDock() {
  const { mode: chapter, goTo, moment } = useTwin();
  const { open, setOpen, orb, planner } = useSavy();

  // The Ask chapter is the conversation at full size; the panel would only repeat it.
  const visible = open && chapter !== "ask";
  const layer = useLayer<HTMLElement>(visible, () => setOpen(false));

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          ref={layer}
          tabIndex={-1}
          role="dialog"
          aria-label="Ask Savy"
          initial={{ x: "104%", opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "104%", opacity: 0.6 }}
          transition={SPRING.snappy}
          className="glass fixed inset-y-0 right-0 z-40 flex outline-none w-full flex-col border-l border-line shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.95)] sm:inset-y-3 sm:right-3 sm:w-[29rem] sm:rounded-3xl sm:border"
        >
          <div aria-hidden className="aurora pointer-events-none absolute inset-0 sm:rounded-3xl" />

          <header className="relative flex items-center justify-between gap-3 border-b border-line/70 px-5 py-4">
            <div className="flex items-center gap-3">
              <motion.span layoutId="savy-orb" className="flex">
                <MorphOrb size={34} state={orb} alive={moment !== null} />
              </motion.span>
              <div>
                <p className="font-display text-xl leading-none text-ink-hi">Savy</p>
                <p className="mt-1.5 text-[0.6875rem] leading-none text-ink-lo">
                  {planner?.mode === "model" ? planner.model : "Sample-data demo"} · drafts and explains; you decide
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Open the full view, with the live pipeline"
                aria-label="Open the full Ask Savy view"
                onClick={() => {
                  goTo("ask");
                  setOpen(false);
                }}
                className="flex size-9 items-center justify-center rounded-full text-ink-mid transition-colors hover:bg-ground-3 hover:text-ink-hi"
              >
                <Maximize2 aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Close Ask Savy"
                onClick={() => setOpen(false)}
                className="flex size-9 items-center justify-center rounded-full text-ink-mid transition-colors hover:bg-ground-3 hover:text-ink-hi"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1 flex-col">
            <SavyConversation variant="dock" autoFocus />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

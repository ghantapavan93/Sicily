"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, CircleAlert } from "lucide-react";
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A vertical chain of steps, each done, active, pending or failed, each
 * collapsible. Used to show what Savy observably did: the systems it read
 * and the checks it ran. It shows actions and results, never reasoning.
 */

export type ThoughtStatus = "done" | "active" | "pending" | "error";

interface StepContext {
  status: ThoughtStatus;
  open: boolean;
  toggle: () => void;
  contentId: string;
}

const StepCtx = createContext<StepContext | null>(null);

function useStep(): StepContext {
  const ctx = useContext(StepCtx);
  if (!ctx) throw new Error("ThoughtChain parts must be used inside <ThoughtChainStep>");
  return ctx;
}

export function ThoughtChain({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cn("relative", className)}>{children}</ol>;
}

interface ThoughtChainStepProps {
  status: ThoughtStatus;
  /** Open by default while active; closed once done, unless told otherwise. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function ThoughtChainStep({ status, defaultOpen, children }: ThoughtChainStepProps) {
  const contentId = useId();
  const [open, setOpen] = useState(defaultOpen ?? status !== "pending");

  // A step opens itself when work reaches it.
  useEffect(() => {
    if (status === "active") setOpen(true);
  }, [status]);

  return (
    <StepCtx.Provider value={{ status, open, toggle: () => setOpen((o) => !o), contentId }}>
      <motion.li
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: status === "pending" ? 0.55 : 1, x: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="relative pb-3 pl-7 last:pb-0"
      >
        {/* the rail joining this step to the next */}
        <span
          aria-hidden
          className={cn(
            "absolute left-[7px] top-5 bottom-0 w-px",
            status === "done" ? "bg-verified/50" : status === "active" ? "bg-brass/50" : "bg-line",
          )}
        />
        <StatusMark status={status} />
        {children}
      </motion.li>
    </StepCtx.Provider>
  );
}

function StatusMark({ status }: { status: ThoughtStatus }) {
  return (
    <span aria-hidden className="absolute left-0 top-0.5 flex size-[15px] items-center justify-center">
      {status === "done" && (
        <span className="flex size-[15px] items-center justify-center rounded-full bg-verified text-ground-0">
          <Check className="size-2.5" strokeWidth={3.5} />
        </span>
      )}
      {status === "active" && (
        <span className="size-[15px] animate-spin rounded-full border-2 border-brass/25 border-t-brass-ink" />
      )}
      {status === "pending" && <span className="size-[13px] rounded-full border-[1.5px] border-ink-lo" />}
      {status === "error" && <CircleAlert className="size-[15px] text-conflict" />}
    </span>
  );
}

export function ThoughtChainTrigger({ children }: { children: ReactNode }) {
  const { status, open, toggle, contentId } = useStep();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-controls={contentId}
      className="group flex w-full items-center gap-2 text-left"
    >
      <span
        className={cn(
          "text-sm font-medium",
          status === "pending" ? "text-ink-lo" : status === "error" ? "text-conflict" : "text-ink-hi",
        )}
      >
        {children}
      </span>
      <ChevronDown
        aria-hidden
        className={cn("size-3.5 text-ink-lo transition-transform duration-200", open && "rotate-180")}
      />
      {status === "active" && (
        <span className="rounded-full border border-brass/50 bg-brass/10 px-2 py-px text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-brass-ink">
          In progress
        </span>
      )}
    </button>
  );
}

export function ThoughtChainContent({ children }: { children: ReactNode }) {
  const { open, contentId } = useStep();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          id={contentId}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <ul className="space-y-1.5 pt-2">{children}</ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ThoughtChainItem({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "error" }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className={cn("flex gap-2 text-xs leading-snug", tone === "error" ? "text-conflict" : "text-ink-mid")}
    >
      <span aria-hidden className="mt-[0.4rem] size-[3px] shrink-0 rounded-full bg-current opacity-60" />
      <span className="min-w-0">{children}</span>
    </motion.li>
  );
}

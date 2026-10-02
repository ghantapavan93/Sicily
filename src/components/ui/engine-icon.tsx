import { BookMarked, GitMerge, Layers, Radar, Route, ShieldCheck, type LucideIcon } from "lucide-react";
import type { EngineId } from "@/twin/pulse";
import { cn } from "@/lib/utils";

/** The six Savy engines, each with its own mark. A prototype hypothesis, not OPSAVOR's architecture. */
export const ENGINE_ICON: Record<EngineId, LucideIcon> = {
  observe: Radar,
  reconcile: GitMerge,
  understand: Layers,
  plan: Route,
  guard: ShieldCheck,
  learn: BookMarked,
};

export function EngineIcon({ engine, className }: { engine: EngineId; className?: string }) {
  const Icon = ENGINE_ICON[engine];
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} strokeWidth={1.75} />;
}

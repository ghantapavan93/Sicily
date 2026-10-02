import { cn } from "@/lib/utils";

export type OrbState = "idle" | "thinking" | "speaking";

interface MorphOrbProps {
  /** Diameter in pixels. */
  size?: number;
  /** Idle turns slowly. Thinking spins and changes shape. Speaking turns steadily. */
  state?: OrbState;
  /** One of Savy's moments is in progress: the brass ring takes the spectrum, then fades back. */
  alive?: boolean;
  className?: string;
}

const LABEL: Record<OrbState, string> = {
  idle: "Savy is ready",
  thinking: "Savy is working",
  speaking: "Savy is answering",
};

/**
 * Savy's presence on screen. The orb is the only thing that moves when Savy
 * is busy, so its state is the status: it is announced to screen readers
 * and the shape change is never the only signal of work in progress.
 */
export function MorphOrb({ size = 56, state = "idle", alive = false, className }: MorphOrbProps) {
  return (
    <span
      role="img"
      aria-label={LABEL[state]}
      data-state={state}
      data-alive={alive}
      className={cn("orb", className)}
      style={{ width: size, height: size }}
    >
      <span className="orb-halo" />
      <span className="orb-ring" />
      <span className="orb-core" />
      <span className="orb-sheen" />
    </span>
  );
}

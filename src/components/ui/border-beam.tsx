import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface BorderBeamProps {
  children: ReactNode;
  /** Thickness of the beam. */
  size?: "sm" | "md" | "lg";
  /** Shows the beam: the input has focus, or Savy is working. Otherwise there is none. */
  active?: boolean;
  /** Corner radius in pixels. Match the wrapped element. */
  radius?: number;
  className?: string;
}

const WIDTH = { sm: 1, md: 1.5, lg: 2 } as const;

/**
 * Wraps an element with a brass light that travels round its border while the
 * element is in use. The beam is a masked conic gradient driven by one
 * registered custom property, so it costs no layout and stops under reduced
 * motion.
 */
export function BorderBeam({
  children,
  size = "md",
  active = false,
  radius = 20,
  className,
}: BorderBeamProps) {
  return (
    <div
      data-active={active}
      className={cn("beam", className)}
      style={{ "--beam-width": `${WIDTH[size]}px`, "--beam-radius": `${radius}px` } as CSSProperties}
    >
      {children}
    </div>
  );
}
